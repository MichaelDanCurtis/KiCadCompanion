// Adapter for the private native extension. Server registration is separately
// qualified and narrowly scoped; construction alone does not authorize native writes.
// No raw file writes, fallback, auto-rebinding or automatic undo.
import {z} from 'zod';
import {digest} from '../actions.mjs';
import {ipcAddressSchema, observeKonnectBinding} from './konnect-binding.mjs';

const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const vector=z.object({x:z.number().finite(),y:z.number().finite(),z:z.number().finite()}).strict();
const scale=vector.refine(v=>[v.x,v.y,v.z].every(n=>n>0),'Scale must be positive');
const model=z.object({filename:z.string().min(1).max(4096).refine(s=>!s.includes('\0')),
  scale,rotation:vector,offset:vector,visible:z.boolean(),opacity:z.number().min(0).max(1)}).strict();
const replacement=z.object({footprint:uuid,models:z.array(model).max(32)}).strict();
const replacements=z.array(replacement).min(1).max(128).refine(items=>new Set(items.map(i=>i.footprint)).size===items.length);
const argsSchema=z.object({replacements}).strict();
const contextSchema=z.object({experimental:z.literal(true),native_instance:uuid,board:z.string(),source:z.literal('ipc'),
  approval_granted:z.literal(false),revision_verified:z.literal(false)}).strict();
const previewSchema=z.object({experimental:z.literal(true),token:uuid,revision:hash,
  expires_in_seconds:z.number().int().positive().max(120),before:replacements,approval_granted:z.literal(false)}).strict();
const resultSchema=z.object({experimental:z.literal(true),token:uuid,
  outcome:z.enum(['MU_APPLIED','MU_NO_CHANGE','MU_REJECTED','MU_UNKNOWN']),detail:z.string(),
  state_verified:z.literal(false),retry_authorized:z.literal(false)}).strict();
const dispatchSchema=z.object({version:z.literal(1),kind:z.literal('konnect-models'),token:uuid,
  nativeInstance:uuid,ipcAddress:ipcAddressSchema,board:z.string(),inputRevision:hash,
  beforeDigest:hash,operationDigest:hash,expiresAt:z.number().finite()}).strict();
const requiredTools=['open_project','experimental_get_model_context','experimental_preview_placed_models',
  'experimental_apply_placed_models','experimental_inspect_model_result'];
const ordered=items=>[...items].sort((a,b)=>a.footprint.localeCompare(b.footprint));
const modelsDigest=items=>digest(ordered(items));

export class KonnectModelsAdapter {
  version=1;
  // This property describes the native ticket's conditional apply, not general
  // tool safety. The server uses the separately pinned/scoped registration helper.
  atomicRevisionCheck=true;
  constructor({connection,expectedIpcAddress,nativeInstance,enabled=false,now=Date.now}) {
    this.connection=connection;this.expectedIpcAddress=ipcAddressSchema.parse(expectedIpcAddress);
    this.nativeInstance=uuid.parse(nativeInstance);this.enabled=z.boolean().parse(enabled);this.now=now;
  }
  capabilities(){return [{operation:'set-placed-models',version:1,effect:'write',supported:this.enabled,
    ...(!this.enabled?{reason:'Private native candidate is not qualified for production'}:{})}];}
  validate(operation,args){if(operation!=='set-placed-models')throw Error('Unsupported native model operation');return argsSchema.parse(args);}
  operation(target,input){return {board:target.path,native_instance:this.nativeInstance,...this.validate(input.operation,input.args)};}
  async bound(target){
    if(!this.enabled||!target.path.endsWith('.kicad_pcb'))throw Error('Native model candidate unavailable');
    const k=await this.connection();
    if(!requiredTools.every(name=>k.tools?.some(t=>t.name===name)))throw Error('Native conditional model capabilities unavailable');
    await observeKonnectBinding(k,target,this.expectedIpcAddress);
    const context=contextSchema.parse(await k.call('experimental_get_model_context',{board:target.path}));
    if(context.board!==target.path||context.native_instance!==this.nativeInstance)throw Error('Native instance/document changed');
    return k;
  }
  async snapshot(target,input){
    const k=await this.bound(target),operation=this.operation(target,input);
    const snapshot=previewSchema.parse(await k.call('experimental_preview_placed_models',operation));
    if(digest(ordered(snapshot.before).map(i=>i.footprint))!==digest(ordered(operation.replacements).map(i=>i.footprint)))throw Error('Native preview target mismatch');
    return {k,operation,snapshot};
  }
  async observe(target,input){
    const {snapshot}=await this.snapshot(target,input);
    return {projectId:input.projectId,documentId:input.documentId,path:target.path,
      revision:snapshot.revision,observedAt:this.now(),connected:true};
  }
  async preview(target,input,observation){
    const operation=this.operation(target,input);
    return {revision:observation.revision,summary:`Replace complete model lists on ${operation.replacements.length} placed footprint(s); native document stays unsaved.`,
      confirmation:`Native model-only v1; editor ${this.nativeInstance}; IPC ${this.expectedIpcAddress}; exact UUIDs, model paths and transforms; no save or automatic undo.`};
  }
  async prepareDispatch(target,input,observation){
    const {operation,snapshot}=await this.snapshot(target,input);
    if(snapshot.revision!==observation.revision)throw Error('Native revision changed before dispatch');
    return dispatchSchema.parse({version:1,kind:'konnect-models',token:snapshot.token,nativeInstance:this.nativeInstance,
      ipcAddress:this.expectedIpcAddress,board:target.path,inputRevision:snapshot.revision,
      beforeDigest:modelsDigest(snapshot.before),operationDigest:digest(operation),
      expiresAt:this.now()+snapshot.expires_in_seconds*1000});
  }
  dispatch(target,input,raw){
    const d=dispatchSchema.parse(raw);
    if(d.nativeInstance!==this.nativeInstance||d.ipcAddress!==this.expectedIpcAddress||d.board!==target.path||
      d.operationDigest!==digest(this.operation(target,input)))throw Error('Native dispatch binding changed');
    return d;
  }
  async execute(target,input,observation,preview,raw){
    const d=this.dispatch(target,input,raw);
    if(d.inputRevision!==observation.revision||this.now()>d.expiresAt)throw Error('Native ticket expired or changed');
    const k=await this.bound(target);
    // Do not preview again here: the native endpoint has one current ticket per
    // board. Its apply checks full live revision and exact arguments atomically.
    const result=resultSchema.parse(await k.call('experimental_apply_placed_models',{operation:this.operation(target,input),token:d.token}));
    if(result.token!==d.token||!['MU_APPLIED','MU_NO_CHANGE'].includes(result.outcome))throw Error('Native outcome unverified; inspect, never retry');
    return {dispatch:d,result};
  }
  async verify(target,input,receipt){
    try {
      const d=this.dispatch(target,input,receipt.dispatch),r=resultSchema.parse(receipt.result);
      if(r.token!==d.token||!['MU_APPLIED','MU_NO_CHANGE'].includes(r.outcome))return {verified:false};
      const {snapshot}=await this.snapshot(target,input);
      return {verified:modelsDigest(snapshot.before)===modelsDigest(input.args.replacements),
        revision:snapshot.revision,scope:'Current selected model lists match; not a save, whole-design validation or physical fit test'};
    }catch{return {verified:false};}
  }
  async cancel(){return {supported:false,reason:'Stop future dispatch only; native apply cannot be rolled back automatically'};}
  async inspect(target,action){
    const d=this.dispatch(target,action.input,action.dispatch),k=await this.bound(target);
    let receipt=null;
    try {receipt=resultSchema.parse(await k.call('experimental_inspect_model_result',{native_instance:this.nativeInstance,token:d.token}));
      if(receipt.token!==d.token)throw Error('Native receipt mismatch');
    }catch{receipt=null;}
    const {snapshot}=await this.snapshot(target,action.input);
    const currentDigest=modelsDigest(snapshot.before);
    return {nativeInstance:this.nativeInstance,revision:snapshot.revision,token:d.token,
      currentDigest,beforeMatches:currentDigest===d.beforeDigest,
      requestedMatches:currentDigest===modelsDigest(action.input.args.replacements),
      receiptOutcome:receipt?.outcome??'unavailable',doesNotAuthorizeReplay:true};
  }
  async reviewRecovery(target,action){
    if(action.input.operation!=='set-placed-models'||action.effect!=='write')throw Error('Unsupported native recovery');
    const state=await this.inspect(target,action);
    if(!state.requestedMatches&&!state.beforeMatches)throw Error('Native models match neither reviewed state; manual reconciliation required');
    return {version:1,revision:state.revision,basis:state.requestedMatches?'postcondition-observed':'precondition-observed',
      summary:'Current selected model state observed. Original outcome stays unknown; accepting this state does not retry, save or undo.',details:state};
  }
}
