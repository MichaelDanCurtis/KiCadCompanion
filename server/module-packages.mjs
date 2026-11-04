import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {z} from 'zod';
import {modulePackageSchema,moduleFacts,moduleDesignReadiness,bomSchema,compareOffers} from '../shared/modules.mjs';
import {createModuleSourceReader,sourceObservationSchema} from './module-sources.mjs';
import {createDigiKeyReader,distributorObservationSchema} from './distributor-digikey.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict=message=>Object.assign(Error(message),{status:409});
const id=z.string().uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive();
const event=z.object({at:z.string().datetime(),kind:z.enum(['imported','field-confirmed','field-unknown']),field:z.string().nullable(),note:z.string().max(2000)}).strict();
const snapshot=z.object({revision,sha256:sha,package:modulePackageSchema,events:z.array(event)}).strict();
const packageRecord=z.object({id,projectId:id,revision,sha256:sha,package:modulePackageSchema,parentId:id.nullable(),
  createdAt:z.string().datetime(),events:z.array(event).max(2000),history:z.array(snapshot).max(2000)}).strict();
const bomRecord=z.object({id,projectId:id,bom:bomSchema,sha256:sha,createdAt:z.string().datetime()}).strict();
const retrievalRecord=z.object({requestId:id,projectId:id,recordId:id,sourceId:id,expectedHash:sha,
  expectedRevision:revision,expectedSha256:sha,sourceUrl:z.string(),priorSourceHash:sha.nullable(),observation:sourceObservationSchema}).strict();
const retrievalInput=z.object({requestId:id,projectId:id,expectedHash:sha,expectedRevision:revision,expectedSha256:sha,sourceId:id}).strict();
const sourcingInput=z.object({requestId:id,projectId:id,expectedHash:sha,expectedBomRevision:revision,expectedBomSha256:sha,itemId:id}).strict();
const sourcingRecord=sourcingInput.extend({bomRecordId:id,moduleRecordId:id,moduleRevision:revision,moduleSha256:sha,observation:distributorObservationSchema}).strict();
const disk=z.object({schemaVersion:z.literal(1),packages:z.array(packageRecord).max(100),boms:z.array(bomRecord).max(100),
  retrievals:z.array(retrievalRecord).max(1000).default([]),sourcing:z.array(sourcingRecord).max(1000).default([])}).strict();

/** Imports are data proposals. No source-status claim, native asset, script,
 * quote or substitute from an import is executed or automatically approved.
 */
export class ModulePackageStore {
  constructor({path,projects,sourceReader=createModuleSourceReader(),distributor=createDigiKeyReader()}){this.path=path;this.projects=projects;this.sourceReader=sourceReader;this.distributor=distributor;this.data={schemaVersion:1,packages:[],boms:[],retrievals:[],sourcing:[]};this.pending=Promise.resolve();}
  async init(){
    try {const data=disk.parse(JSON.parse(await readFile(this.path,'utf8')));
      for(const r of data.packages)if(hash(r.package)!==r.sha256||r.history.some(h=>hash(h.package)!==h.sha256))throw Error('Module package history hash mismatch');
      for(const r of data.boms)if(hash(r.bom)!==r.sha256)throw Error('BOM hash mismatch');this.data=data;
    }catch(e){if(e.code!=='ENOENT')throw Error(`Module records cannot be loaded; original preserved: ${e.message}`);}
  }
  async transact(operation){
    const work=this.pending.then(async()=>{
      const next=structuredClone(this.data),result=await operation(next);disk.parse(next);
      await mkdir(dirname(this.path),{recursive:true,mode:0o700});const temp=`${this.path}.${randomUUID()}.tmp`;
      await writeFile(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,this.path);this.data=next;return structuredClone(result);
    });this.pending=work.catch(()=>{});return work;
  }
  async project(projectId,expectedHash){const project=await this.projects.open(projectId);if(project.hash!==expectedHash)throw conflict('Project changed; refresh before reviewing module data');return project;}
  moduleFor(data,item,projectId){return item.moduleRef&&data.packages.find(p=>p.id===item.moduleRef.id&&p.projectId===projectId&&p.revision===item.moduleRef.revision&&p.sha256===item.moduleRef.sha256);}
  list(projectId){return {packages:this.data.packages.filter(r=>r.projectId===projectId).map(r=>{
    const retrievals=this.data.retrievals.filter(s=>s.projectId===projectId&&s.recordId===r.id),readiness=moduleDesignReadiness(r.package);
    for(const source of r.package.sources){const latest=retrievals.findLast(s=>s.sourceId===source.id);
      if(latest&&(latest.observation.status==='unavailable'||latest.observation.sha256!==source.sha256))
        readiness.blockers.push(`${source.title}: latest retrieval is unavailable or differs from the recorded source; review a separate proposal.`);
    }
    readiness.ready=readiness.blockers.length===0;
    return {...structuredClone(r),readiness,retrievals:structuredClone(retrievals),retrievableSourceIds:r.package.sources.filter(s=>this.sourceReader.supports(r.package,s)).map(s=>s.id)};
  }),
    boms:this.data.boms.filter(r=>r.projectId===projectId).map(r=>({...structuredClone(r),comparison:compareOffers(r.bom),
      sourcing:structuredClone(this.data.sourcing.filter(s=>s.bomRecordId===r.id&&s.projectId===projectId)),
      retrievableItemIds:r.bom.items.filter(item=>this.distributor.supports(item,this.moduleFor(this.data,item,projectId)?.package)).map(item=>item.id),
      unresolvedModuleReferences:r.bom.items.filter(item=>item.moduleRef&&!this.data.packages.some(p=>p.id===item.moduleRef.id&&p.projectId===projectId&&p.revision===item.moduleRef.revision&&p.sha256===item.moduleRef.sha256)).map(item=>item.id)})),
    liveRetrieval:{available:this.sourceReader.available,reason:this.sourceReader.reason},distributor:{available:this.distributor.available,reason:this.distributor.reason}};}
  retrieveSourcing(bomRecordId,raw,{authorize=()=>{}}={}){
    id.parse(bomRecordId);const input=sourcingInput.parse(raw);authorize();
    return this.transact(async data=>{
      authorize();const prior=data.sourcing.find(s=>s.requestId===input.requestId);
      if(prior){if(prior.bomRecordId!==bomRecordId||Object.entries(input).some(([k,v])=>prior[k]!==v))throw conflict('Sourcing request ID already belongs to another request');return prior;}
      if(data.sourcing.length>=1000)throw conflict('Sourcing observation limit reached; preserve evidence before starting another library.');
      const project=await this.project(input.projectId,input.expectedHash);
      const record=data.boms.find(r=>r.id===bomRecordId&&r.projectId===input.projectId);
      if(!record||record.sha256!==input.expectedBomSha256||record.bom.revision!==input.expectedBomRevision)throw conflict('BOM changed; refresh before checking sourcing');
      const item=record.bom.items.find(i=>i.id===input.itemId),module=item&&this.moduleFor(data,item,input.projectId);
      if(!module)throw conflict('BOM needs a current module revision and hash before sourcing');
      authorize();const observation=await this.distributor.observe(item,module.package,{authorize,projectRoot:project.root});
      authorize();await this.project(input.projectId,input.expectedHash);
      const receipt=sourcingRecord.parse({...input,bomRecordId,moduleRecordId:module.id,moduleRevision:module.revision,moduleSha256:module.sha256,observation});
      data.sourcing.push(receipt);return receipt;
    });
  }
  retrieveSource(recordId,raw,{authorize=()=>{}}={}) {
    id.parse(recordId);const input=retrievalInput.parse(raw);authorize();
    return this.transact(async data=>{
      authorize();
      const prior=data.retrievals.find(s=>s.requestId===input.requestId);
      if(prior){if(prior.recordId!==recordId||Object.entries(input).some(([key,value])=>prior[key]!==value))throw conflict('Source request ID already belongs to another request');return prior;}
      if(data.retrievals.length>=1000)throw conflict('Source observation limit reached; retain the evidence before starting a new library.');
      await this.project(input.projectId,input.expectedHash);
      const record=data.packages.find(r=>r.id===recordId&&r.projectId===input.projectId);
      if(!record||record.revision!==input.expectedRevision||record.sha256!==input.expectedSha256)throw conflict('Module record changed; review its current revision');
      const source=record.package.sources.find(s=>s.id===input.sourceId);if(!source)throw conflict('Source is not in this module package');
      authorize();const observation=await this.sourceReader.observe(record.package,source);
      authorize();await this.project(input.projectId,input.expectedHash);
      const receipt=retrievalRecord.parse({...input,recordId,sourceUrl:source.url,priorSourceHash:source.sha256,observation});
      data.retrievals.push(receipt);return receipt;
    });
  }
  importPackage({projectId,expectedHash,package:raw,parentId=null}){
    const candidate=modulePackageSchema.parse(raw);
    // A portable claim is never a review receipt for this project.
    for(const [,fact] of moduleFacts(candidate))if(fact.status!=='unknown'&&fact.status!=='conflicting')fact.status='proposed';
    return this.transact(async data=>{
      await this.project(projectId,expectedHash);
      if(parentId&&!data.packages.some(r=>r.id===parentId&&r.projectId===projectId))throw conflict('Prior module record is not in this project');
      const record={id:randomUUID(),projectId,revision:1,sha256:hash(candidate),package:candidate,parentId,createdAt:new Date().toISOString(),
        events:[{at:new Date().toISOString(),kind:'imported',field:null,note:'Imported as a separate proposal. Source and user confirmations require review in this project.'}],history:[]};
      data.packages.push(record);return record;
    });
  }
  reviewField(recordId,{projectId,expectedHash,expectedRevision,expectedSha256,field,decision,note}) {
    z.object({projectId:id,expectedHash:sha,expectedRevision:revision,expectedSha256:sha,field:z.string().min(1).max(200),
      decision:z.enum(['confirm','unknown']),note:z.string().trim().min(4).max(2000)}).strict().parse({projectId,expectedHash,expectedRevision,expectedSha256,field,decision,note});
    return this.transact(async data=>{
      await this.project(projectId,expectedHash);const record=data.packages.find(r=>r.id===recordId&&r.projectId===projectId);
      if(!record||record.revision!==expectedRevision||record.sha256!==expectedSha256)throw conflict('Module record changed; review its current revision');
      const fact=moduleFacts(record.package).find(([path])=>path===field)?.[1];if(!fact)throw conflict('Unknown module field');
      if(decision==='confirm') {
        if(fact.value===null||fact.status==='conflicting')throw conflict('Unknown or conflicting fields need a new sourced proposal');
        if(fact.sources.some(ref=>['conflicting','unreviewed'].includes(record.package.sources.find(s=>s.id===ref.sourceId)?.revisionStatus)))
          throw conflict('Source revision is conflicting or unreviewed; review a separate sourced proposal');
        if(!fact.sources.length||fact.sources.some(ref=>{const s=record.package.sources.find(s=>s.id===ref.sourceId);return !s?.version||!s.sha256||!s.retrievedAt;}))
          throw conflict('A versioned source locator, content hash and retrieval date are required');
      }
      record.history.push({revision:record.revision,sha256:record.sha256,package:structuredClone(record.package),events:structuredClone(record.events)});
      if(decision==='confirm')fact.status='user-confirmed';else {fact.value=null;fact.status='unknown';}
      fact.note=note;record.revision++;record.sha256=hash(record.package);
      record.events.push({at:new Date().toISOString(),kind:decision==='confirm'?'field-confirmed':'field-unknown',field,note});return record;
    });
  }
  importBom({projectId,expectedHash,bom:raw}) {
    const bom=bomSchema.parse(raw);return this.transact(async data=>{
      await this.project(projectId,expectedHash);
      // Preserve portable references exactly. Missing/stale local modules are
      // reported as unresolved; importing a BOM never installs/replaces them.
      const record={id:randomUUID(),projectId,bom,sha256:hash(bom),createdAt:new Date().toISOString()};data.boms.push(record);return record;
    });
  }
}

export function modulePackageRoutes(app,{store,views}) {
  const scope=z.object({expectedHash:sha}).strict(),base='/api/module-library/projects/:projectId';
  app.get(base,(req,res)=>res.set('Cache-Control','no-store').json(store.list(id.parse(req.params.projectId))));
  app.post(`${base}/packages`,async(req,res)=>{
    const projectId=id.parse(req.params.projectId),input=scope.extend({package:modulePackageSchema,parentId:id.nullable().default(null)}).parse(req.body);
    views.authorize(projectId,req.get('X-Benchline-Controller'));res.json({record:await store.importPackage({projectId,...input})});
  });
  app.post(`${base}/packages/:recordId/review`,async(req,res)=>{
    const projectId=id.parse(req.params.projectId),input=scope.extend({expectedRevision:revision,expectedSha256:sha,field:z.string().min(1).max(200),
      decision:z.enum(['confirm','unknown']),note:z.string().trim().min(4).max(2000)}).parse(req.body);
    views.authorize(projectId,req.get('X-Benchline-Controller'));res.json({record:await store.reviewField(id.parse(req.params.recordId),{projectId,...input})});
  });
  app.post(`${base}/boms`,async(req,res)=>{
    const projectId=id.parse(req.params.projectId),input=scope.extend({bom:bomSchema}).parse(req.body);
    views.authorize(projectId,req.get('X-Benchline-Controller'));res.json({record:await store.importBom({projectId,...input})});
  });
  app.post(`${base}/boms/:recordId/sourcing/retrieve`,async(req,res)=>{
    const projectId=id.parse(req.params.projectId),input=sourcingInput.omit({projectId:true}).parse(req.body);
    const authorize=()=>views.authorize(projectId,req.get('X-Benchline-Controller'));authorize();
    res.json({receipt:await store.retrieveSourcing(id.parse(req.params.recordId),{projectId,...input},{authorize})});
  });
  app.post(`${base}/packages/:recordId/sources/retrieve`,async(req,res)=>{
    const projectId=id.parse(req.params.projectId),input=retrievalInput.omit({projectId:true}).parse(req.body);
    const authorize=()=>views.authorize(projectId,req.get('X-Benchline-Controller'));authorize();
    res.json({receipt:await store.retrieveSource(id.parse(req.params.recordId),{projectId,...input},{authorize})});
  });
}
