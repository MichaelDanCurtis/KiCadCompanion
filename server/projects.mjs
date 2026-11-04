import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir,lstat,realpath,open as openFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {manifestSchema,artifactSchema,projectPath,impactOf} from '../shared/project.mjs';

export const contentHash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const encode=value=>JSON.stringify(value,null,2)+'\n';
const inside=(root,path)=>{const rel=relative(root,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\');};
const emptyLive=()=>({status:'unavailable',revision:null,dirty:null,observedAt:null});
async function atomic(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,encode(value),{flag:'wx',mode:0o600});await rename(temp,path);}
async function readJson(path){return JSON.parse(await readFile(path,'utf8'));}

// Reject all symlink components, including links to locations inside the root.
// Missing artifact files are allowed, but their existing parent chain is checked.
export async function resolveArtifact(root,locator){
  projectPath.parse(locator);const canonical=await realpath(root);let current=canonical;
  for(const segment of locator.split('/')){current=join(current,segment);try{const s=await lstat(current);if(s.isSymbolicLink())throw fail('Artifact symlinks are not allowed');}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(!inside(canonical,current))throw fail('Artifact escapes the project root');return current;
}
async function savedObservation(root,path){
  const target=await resolveArtifact(root,path),at=new Date().toISOString();let handle;
  try{handle=await openFile(target,constants.O_RDONLY|constants.O_NOFOLLOW);const before=await handle.stat();
    if(!before.isFile()||before.size>64*1024*1024)throw fail('Artifact must be a regular file no larger than 64 MiB');
    const data=await handle.readFile();const after=await handle.stat();
    if(before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw fail('Artifact changed during observation; retry');
    await resolveArtifact(root,path);
    return {status:'saved',hash:contentHash(data),bytes:data.length,observedAt:at};
  }catch(e){if(e.code==='ENOENT')return {status:'missing',hash:null,bytes:null,observedAt:at};throw e;}finally{await handle?.close();}
}
const indexSchema=z.object({schemaVersion:z.literal(1),projects:z.array(z.object({id:z.string().uuid(),root:z.string(),name:z.string()}).strict()).max(100)}).strict();
const localSchema=z.object({schemaVersion:z.literal(1),projectId:z.string().uuid(),root:z.string(),epoch:z.string().uuid(),manifestHash:z.string(),manifestRevision:z.number().int(),
  grants:z.array(z.unknown()),fingerprints:z.record(z.string()),changed:z.array(z.string()),observations:z.record(z.unknown()),history:z.array(z.unknown())}).strict();

export class ProjectStore {
  constructor({storageRoot,managedRoot,liveProvider=async()=>null}){this.storageRoot=storageRoot;this.managedRoot=managedRoot;this.liveProvider=liveProvider;this.index={schemaVersion:1,projects:[]};this.pending=Promise.resolve();}
  async init(){try{this.index=indexSchema.parse(await readJson(join(this.storageRoot,'index.json')));}catch(e){if(e.code!=='ENOENT')throw fail('Project index unreadable; existing state preserved');}}
  queue(action){const next=this.pending.then(action);this.pending=next.catch(()=>{});return next;}
  list(){return structuredClone(this.index.projects);}
  async manifest(root){const canonical=await realpath(root);if(!(await lstat(canonical)).isDirectory())throw fail('Project root is not a directory');
    const path=await resolveArtifact(canonical,'benchline.project.json'),raw=await readFile(path,'utf8');if(raw.length>1024*1024)throw fail('Manifest too large');
    const m=manifestSchema.parse(JSON.parse(raw));for(const r of m.requirements)if(r.contentHash!==contentHash(r.text))throw fail('Requirement content hash mismatch');
    for(const a of m.artifacts)await resolveArtifact(canonical,a.path);return {root:canonical,manifest:m,hash:contentHash(raw)};
  }
  async register(root){const view=await this.manifest(root);const prior=this.index.projects.find(p=>p.id===view.manifest.id);
    if(prior&&prior.root!==view.root){try{await lstat(prior.root);throw fail('A project with this ID still exists at another root. Move it instead of opening a duplicate copy.',409);}catch(e){if(e.code!=='ENOENT')throw e;}}
    if(!prior&&this.index.projects.length>=100)throw fail('Project limit reached');
    const next={schemaVersion:1,projects:[...this.index.projects.filter(p=>p.id!==view.manifest.id),{id:view.manifest.id,root:view.root,name:view.manifest.name}]};
    await atomic(join(this.storageRoot,'index.json'),next);this.index=next;return this.observeView(view);
  }
  openRoot(root){return this.queue(()=>this.register(z.string().min(1).max(2048).parse(root)));}
  entry(id){const entry=this.index.projects.find(p=>p.id===id);if(!entry)throw fail('Product project not found',404);return entry;}
  open(id){return this.queue(async()=>{const view=await this.manifest(this.entry(id).root);if(view.manifest.id!==id)throw fail('Manifest project identity changed',409);return this.observeView(view);});}
  async observeView(view){
    const m=view.manifest,path=join(this.storageRoot,m.id+'.json');let state;
    try{state=localSchema.parse(await readJson(path));if(state.projectId!==m.id)throw fail('Project state identity mismatch');}catch(e){if(e.code!=='ENOENT')throw e;}
    const relocated=!!state&&state.root!==view.root,manifestChanged=!!state&&state.manifestHash!==view.hash;
    state??={schemaVersion:1,projectId:m.id,root:view.root,epoch:randomUUID(),manifestHash:view.hash,manifestRevision:m.revision,grants:[],fingerprints:{},changed:[],observations:{},history:[]};
    if(relocated||manifestChanged){state.grants=[];state.epoch=randomUUID();state.observations={};}
    // BL-03 cannot issue or consume execution grants, even if a future state file contains them.
    state.grants=[];
    const fingerprints={},observations={},changed=new Set(state.changed),observedAt=new Date().toISOString();
    for(const r of m.requirements)fingerprints[r.id]=contentHash(JSON.stringify([r.name,r.text,r.dependsOn]));
    for(const a of m.artifacts){const saved=await savedObservation(view.root,a.path),absolutePath=await resolveArtifact(view.root,a.path);let live=emptyLive();
      const signal=await this.liveProvider({projectId:m.id,artifactId:a.id,path:absolutePath});
      if(signal&&signal.projectId===m.id&&signal.artifactId===a.id&&signal.path===absolutePath&&typeof signal.revision==='string'&&typeof signal.dirty==='boolean'&&Date.now()-Date.parse(signal.observedAt)>=0&&Date.now()-Date.parse(signal.observedAt)<10000){live={status:'observed',revision:signal.revision,dirty:signal.dirty,observedAt:signal.observedAt};}
      observations[a.id]={saved,live};fingerprints[a.id]=contentHash(JSON.stringify([a.path,a.dependsOn,saved.status,saved.hash]));
      if(live.dirty)changed.add(a.id);
      const previous=state.observations[a.id]?.live;if(live.status==='observed'&&previous?.status==='observed'&&previous.revision!==live.revision)changed.add(a.id);
    }
    for(const [id,hash] of Object.entries(fingerprints))if(state.fingerprints[id]&&state.fingerprints[id]!==hash)changed.add(id);
    const ids=new Set(Object.keys(fingerprints));const changedIds=[...changed].filter(id=>ids.has(id)).sort();
    const liveSignature=values=>JSON.stringify(Object.entries(values).map(([id,o])=>[id,o.live.status,o.live.revision,o.live.dirty]));
    const changedState=relocated||manifestChanged||JSON.stringify(state.fingerprints)!==JSON.stringify(fingerprints)||JSON.stringify(state.changed)!==JSON.stringify(changedIds)||liveSignature(state.observations)!==liveSignature(observations);
    if(changedState||!state.history.length)state.history.push({manifestRevision:m.revision,manifestHash:view.hash,observedAt,relocated,changed:changedIds,observations});
    if(state.history.length>500)throw fail('Local revision journal limit reached; export/archive review required');
    Object.assign(state,{root:view.root,manifestHash:view.hash,manifestRevision:m.revision,fingerprints,changed:changedIds,observations});
    await atomic(path,state);
    return {...view,local:state,impact:impactOf(m,changedIds),relocated,executionEnabled:false};
  }
  create({name,brief=null}){return this.queue(async()=>{
    const id=randomUUID(),m={schemaVersion:1,id,name,revision:1,sourceBrief:brief?{id:brief.id,revision:brief.revision}:null,requirements:[],artifacts:[]};
    if(brief){for(const [key,value] of Object.entries(brief.brief)){if(typeof value==='string'&&value.trim())m.requirements.push({id:randomUUID(),name:key,text:value.trim(),dependsOn:[],revision:1,contentHash:contentHash(value.trim())});}}
    manifestSchema.parse(m);const root=join(this.managedRoot,id);await mkdir(root,{recursive:true,mode:0o700});
    await writeFile(join(root,'benchline.project.json'),encode(m),{flag:'wx',mode:0o600});return this.register(root);
  });}
  edit(id,expectedRevision,expectedHash,operation){return this.queue(async()=>{
    const view=await this.manifest(this.entry(id).root);if(view.manifest.id!==id)throw fail('Manifest project identity changed',409);
    if(view.manifest.revision!==expectedRevision||view.hash!==expectedHash)throw fail('Project changed in another window or on disk; refresh before saving',409);
    const m=structuredClone(view.manifest);operation(m);m.revision++;manifestSchema.parse(m);
    for(const a of m.artifacts)await savedObservation(view.root,a.path);
    // Detect external edits again immediately before replacing only our manifest.
    if(contentHash(await readFile(join(view.root,'benchline.project.json')))!==view.hash)throw fail('Manifest changed while saving',409);
    await atomic(join(view.root,'benchline.project.json'),m);return this.observeView(await this.manifest(view.root));
  });}
  addArtifact(id,revision,hash,input){return this.edit(id,revision,hash,m=>{m.artifacts.push(artifactSchema.parse({...input,id:randomUUID()}));});}
  setRequirement(id,revision,hash,input){return this.edit(id,revision,hash,m=>{
    const data=z.object({id:z.string().uuid().optional(),name:z.string().trim().min(1).max(160),text:z.string().trim().min(1).max(4000),dependsOn:z.array(z.string().uuid()).max(500)}).strict().parse(input);
    const existing=data.id?m.requirements.find(r=>r.id===data.id):null;if(data.id&&!existing)throw fail('Requirement not found',404);
    const r={...data,id:existing?.id||randomUUID(),revision:existing?existing.revision+1:1,contentHash:contentHash(data.text)};
    if(existing)Object.assign(existing,r);else m.requirements.push(r);
  });}
}

export function projectRoutes(app,store,briefs){
  const version=z.number().int().positive(),hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().uuid();
  app.get('/api/product-projects',(req,res)=>res.json({projects:store.list(),executionEnabled:false}));
  app.post('/api/product-projects',async(req,res)=>{const body=z.object({name:z.string().trim().min(1).max(100),briefId:id.optional(),briefRevision:version.optional()}).strict().parse(req.body);
    const brief=body.briefId?briefs.list().find(b=>b.id===body.briefId):null;if(body.briefId&&(!brief||brief.revision!==body.briefRevision))throw fail('Brief changed or not found; refresh before creating a project',409);
    res.status(201).json(await store.create({name:body.name,brief}));});
  app.post('/api/product-projects/open',async(req,res)=>res.json(await store.openRoot(req.body.root)));
  app.get('/api/product-projects/:id',async(req,res)=>res.json(await store.open(id.parse(req.params.id))));
  app.post('/api/product-projects/:id/artifacts',async(req,res)=>res.json(await store.addArtifact(id.parse(req.params.id),version.parse(req.body.expectedRevision),hash.parse(req.body.expectedHash),req.body.artifact)));
  app.post('/api/product-projects/:id/requirements',async(req,res)=>res.json(await store.setRequirement(id.parse(req.params.id),version.parse(req.body.expectedRevision),hash.parse(req.body.expectedHash),req.body.requirement)));
}
