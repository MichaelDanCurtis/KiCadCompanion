import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';

const id=z.string().uuid();
const denied=()=>Object.assign(Error('This window does not control the selected project. Refresh its workspace view.'),{status:403});
const conflict=message=>Object.assign(Error(message),{status:409});
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

/** Ephemeral UI ownership, independent of engineering permissions and journals.
 * Server restart invalidates every view/token. It does not restore tool grants,
 * replay actions, or adopt a provider conversation. Project/action stores retain
 * their existing revision and recovery authorities.
 */
export class WorkspaceViews {
  #projects; #quiesce; #records=new Map(); #viewIds=new Map();
  constructor({projects,quiesce}) {this.#projects=projects;this.#quiesce=quiesce;}
  #public(record) {return {viewId:record.viewId,projectId:record.projectId,
    phase:record.phase,selection:record.selection,revision:record.revision};}
  #record(viewId) {
    const record=this.#records.get(this.#viewIds.get(id.parse(viewId)));
    if(!record) throw Object.assign(Error('Workspace view expired; reopen it from the product workspace.'),{status:404});
    return record;
  }
  async join(raw,token,claimNonce) {
    if(claimNonce!==undefined && (typeof claimNonce!=='string'||!/^[a-f0-9]{64}$/.test(claimNonce)))throw denied();
    const input=z.object({projectId:id,expectedManifestHash:z.string().regex(/^[a-f0-9]{64}$/),expectedEpoch:id}).strict().parse(raw);
    const project=await this.#projects.open(input.projectId);
    if(project.hash!==input.expectedManifestHash || project.local.epoch!==input.expectedEpoch)
      throw conflict('Project changed before opening its workspace view. Refresh the project.');
    let record=this.#records.get(input.projectId);
    // The check and insertion are synchronous after the asynchronous observation.
    // Two joining requests cannot both mint authority for one project.
    if(!record) {
      if(this.#records.size>=100) throw conflict('Workspace view limit reached. Close an unused controller first.');
      record={viewId:randomUUID(),projectId:input.projectId,token:randomBytes(32).toString('hex'),claimNonce,
        phase:'ready',selection:null,revision:1};
      this.#records.set(input.projectId,record);this.#viewIds.set(record.viewId,input.projectId);
      return {...this.#public(record),role:'controller',controllerToken:record.token};
    }
    const owns=record.phase==='ready' && (equal(record.token,token)||equal(record.claimNonce,claimNonce));
    return {...this.#public(record),role:owns?'controller':'observer',...(owns?{controllerToken:record.token}:{})};
  }
  authorize(projectId,token) {
    const record=this.#records.get(id.parse(projectId));
    if(!record || record.phase!=='ready' || !equal(record.token,token)) throw denied();
    return this.#public(record);
  }
  async read(viewId) {
    const record=this.#record(viewId),project=await this.#projects.open(record.projectId);
    // A manifest edit can remove the selection, but cannot turn another file
    // into it. No fallback to an open board, first artifact, or customer project.
    if(record.selection && !project.manifest.artifacts.some(a=>a.id===record.selection)) {
      record.selection=null;record.revision++;
    }
    return {...this.#public(record),project};
  }
  async select(viewId,raw) {
    const input=z.object({artifactId:id.nullable(),expectedRevision:z.number().int().positive()}).strict().parse(raw);
    const record=this.#record(viewId),project=await this.#projects.open(record.projectId);
    if(this.#records.get(record.projectId)!==record || record.phase!=='ready') throw conflict('Workspace control is changing. Refresh the view.');
    if(record.revision!==input.expectedRevision) throw conflict('Selection changed in another window. Refresh before selecting again.');
    if(input.artifactId && !project.manifest.artifacts.some(a=>a.id===input.artifactId)) throw conflict('Artifact is not in this project.');
    record.selection=input.artifactId;record.revision++;
    return this.#public(record);
  }
  async release(viewId,token) {
    const record=this.#record(viewId);this.authorize(record.projectId,token);
    // Revoke HTTP admission BEFORE waiting for existing work. No new client can
    // acquire control while provider/action/project cleanup is unresolved.
    record.phase='releasing';record.revision++;
    try {await this.#quiesce(record.projectId);}
    catch {record.phase='blocked';throw conflict('Workspace cleanup did not finish. Control stays blocked; inspect recovery before restarting.');}
    this.#viewIds.delete(record.viewId);this.#records.delete(record.projectId);
    return {released:true,projectId:record.projectId};
  }
}

export function workspaceViewRoutes(app,views) {
  const prefix='/api/workspace-views';
  app.post(`${prefix}/join`,async(req,res)=>res.json(await views.join(req.body,req.get('X-Benchline-Controller'),req.get('X-Benchline-Claim'))));
  app.get(`${prefix}/:id`,async(req,res)=>res.json(await views.read(req.params.id)));
  // Selection is shared review context only, never an editor/tool operation.
  app.post(`${prefix}/:id/selection`,async(req,res)=>res.json(await views.select(req.params.id,req.body)));
  app.post(`${prefix}/:id/release`,async(req,res)=>{
    z.object({}).strict().parse(req.body);res.json(await views.release(req.params.id,req.get('X-Benchline-Controller')));
  });
}

// Install before product mutation routes. Internal mediated provider tools keep
// their existing BL-04 session/approval boundary; this is the browser admission
// boundary. Reading a public view/selection ID never supplies controller authority.
export function workspaceMutationGuard({views,gate,provider}) {
  return (req,res,next)=>{
    if(req.method!=='POST') return next();
    const path=req.path.toLowerCase().replace(/\/+$/,''),token=req.get('X-Benchline-Controller');
    let projectId;
    const project=path.match(/^\/api\/product-projects\/([^/]+)\/(?:requirements|artifacts)$/);
    if(project) projectId=project[1];
    else if(path==='/api/actions/prepare') projectId=req.body?.projectId;
    else if(path.startsWith('/api/actions/')) {
      const action=path.match(/^\/api\/actions\/([^/]+)\//);
      if(!action) throw denied();
      projectId=gate().get(id.parse(action[1])).input.projectId;
    } else if(path.startsWith('/api/action-grants/')) {
      const grant=gate().data.grants.find(g=>g.id===path.split('/')[3]);
      if(!grant) throw denied();
      projectId=grant.projectId;
    } else if(path.startsWith('/api/provider/product/')) {
      projectId=path==='/api/provider/product/select' ? req.body?.projectId : provider().status().scope?.projectId;
      if(!projectId) throw denied();
    } else return next();
    views().authorize(projectId,token);next();
  };
}
