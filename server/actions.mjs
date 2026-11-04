import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {actionInput,observationSchema,previewSchema,terminalStates,journalSchema,targetSchema,recoveryInspectionSchema,recoveryDecisionSchema,dispatchSchema} from '../shared/actions.mjs';
import {providerResultSchema} from '../shared/provider-results.mjs';

export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const reject=(message,status=409)=>Object.assign(new Error(message),{status});
const copy=value=>structuredClone(value);
const capabilitySchema=z.object({operation:z.string().min(1),version:z.number().int().positive(),effect:z.enum(['read','write','editor']),supported:z.boolean(),reason:z.string().optional()}).strict();

// Only trusted host code registers adapters. No arbitrary MCP tool/CLI proxy.
export class ActionGate {
  constructor({path,resolveTarget,adapters,now=Date.now}){Object.assign(this,{path,resolveTarget,adapters,now});this.data={schemaVersion:1,actions:[],grants:[]};this.pending=Promise.resolve();this.active=new Set();this.cancelled=new Set();this.revoked=new Set();this.broken=false;}
  queue(fn){const p=this.pending.then(()=>{if(this.broken)throw reject('Action persistence failed; restart and inspect recovery before continuing');return fn();});this.pending=p.catch(()=>{});return p;}
  async init(){try{this.data=journalSchema.parse(JSON.parse(await readFile(this.path,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const a of this.data.actions){delete a.recoveryReview;if(a.state==='executing'){a.state='unknown';a.detail='Process ended during execution; inspect outcome, never replay automatically';}else if(!terminalStates.has(a.state)){a.state='expired';a.detail='Pending previews and approvals expire on restart';}}
    await this.save();
  }
  async save(){try{journalSchema.parse(this.data);await mkdir(dirname(this.path),{recursive:true,mode:0o700});const temp=this.path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(this.data,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,this.path);}catch(e){this.broken=true;throw e;}}
  list(projectId){return copy({actions:this.data.actions.filter(a=>a.input.projectId===projectId),grants:this.data.grants.filter(g=>g.projectId===projectId),broken:this.broken});}
  get(id){const a=this.data.actions.find(a=>a.id===id);if(!a)throw reject('Unknown action',404);return a;}
  async waitForDecision(id,{signal}={}){
    // Host-only wait. Never hold the serialization queue while a human decides.
    // Read behind completed writes so an in-memory approval is not returned
    // before persistence succeeds. Stop/close abort the delay immediately.
    for(;;){
      signal?.throwIfAborted();
      const action=await this.queue(async()=>{
        signal?.throwIfAborted();
        const a=this.get(id);
        if(a.state==='awaiting-approval'&&this.now()>a.expiresAt){
          a.state='expired';a.detail='Approval window expired; prepare a fresh action';await this.save();
        }
        return copy(a);
      });
      signal?.throwIfAborted();
      if(action.state!=='awaiting-approval')return action;
      await delay(Math.max(1,Math.min(250,action.expiresAt-this.now()+1)),undefined,{signal});
    }
  }
  providerResult(id){
    const a=this.get(id);
    if(a.effect!=='read')return {status:'not-applicable'};
    if(this.broken||a.state!=='verified'||a.verification?.verified!==true)return {status:'unavailable'};
    try {
      const adapter=this.adapters.get(a.input.adapter);
      if(typeof adapter?.projectResult!=='function')return {status:'unsupported'};
      const result=providerResultSchema.parse(adapter.projectResult(copy(a.target),copy(a.input),copy(a.receipt)));
      if(Buffer.byteLength(JSON.stringify(result),'utf8')>8192)throw Error('Projection too large');
      return {status:'available',data:result};
    }catch{return {status:'unavailable'};}
  }
  adapter(input){const a=this.adapters.get(input.adapter),raw=a?.capabilities().find(c=>c.operation===input.operation);if(!a||a.version!==1||!raw?.supported)throw reject(raw?.reason||'Unsupported adapter or capability',422);const cap=capabilitySchema.parse(raw);if(input.mode==='discuss'&&cap.effect!=='read')throw reject('Discuss mode cannot mutate documents or editor state',403);if(cap.effect!=='read'&&a.atomicRevisionCheck!==true)throw reject('Adapter lacks an atomic native revision guard',422);return {adapter:a,cap};}
  async observe(adapter,target,input){const o=observationSchema.parse(await adapter.observe(copy(target),copy(input)));if(o.projectId!==input.projectId||o.documentId!==input.documentId||o.path!==target.path)throw reject('Wrong document identity');if(this.now()-o.observedAt<0||this.now()-o.observedAt>10000)throw reject('Stale document observation');return o;}
  scope(input,target,cap,preview){return digest({version:1,projectId:input.projectId,documentId:input.documentId,path:target.path,epoch:target.epoch,adapter:input.adapter,operation:input.operation,args:input.args,capabilityVersion:cap.version,effect:cap.effect,confirmation:preview.confirmation});}
  hasUnresolved(input){return this.data.actions.some(a=>a.input.projectId===input.projectId&&a.input.documentId===input.documentId&&a.state==='unknown'&&!a.reconciliation);}
  async fresh(a){if(this.hasUnresolved(a.input))throw reject('Document has an uncertain action; recovery review required');const {adapter,cap}=this.adapter(a.input),target=await this.resolveTarget(a.input);if(digest(target)!==digest(a.target))throw reject('Project identity, root or manifest changed; prepare again');
    const o=await this.observe(adapter,target,a.input),p=previewSchema.parse(await adapter.preview(copy(target),copy(a.input),copy(o)));
    if(digest(adapter.validate(a.input.operation,a.input.args))!==digest(a.input.args)||this.scope(a.input,target,cap,p)!==a.scope)throw reject('Capability, arguments or confirmation changed; prepare again');
    if(o.revision!==a.observation.revision||digest(p)!==digest(a.preview)||this.now()>a.expiresAt)throw reject('Preview expired or document changed; prepare again');return {adapter,cap,target};
  }
  async prepare(raw){return this.queue(async()=>{const input=actionInput.parse(raw);const prior=this.data.actions.find(a=>a.input.projectId===input.projectId&&a.input.idempotencyKey===input.idempotencyKey);
    if(prior){if(digest(prior.input)!==digest(input))throw reject('Idempotency key cannot be reused with different arguments');return copy(prior);}
    if(this.data.actions.length>=1000)throw reject('Action journal full; review/export required');
    if(this.hasUnresolved(input))throw reject('Document has an uncertain action; recovery inspection required');
    const {adapter,cap}=this.adapter(input);input.args=adapter.validate(input.operation,input.args);const target=targetSchema.parse(await this.resolveTarget(input));
    const observation=await this.observe(adapter,target,input),preview=previewSchema.parse(await adapter.preview(copy(target),copy(input),copy(observation)));
    const scope=this.scope(input,target,cap,preview),grant=this.data.grants.find(g=>g.scope===scope&&!this.revoked.has(g.id));
    const a={id:randomUUID(),input,target,observation,preview,scope,effect:cap.effect,createdAt:this.now(),expiresAt:this.now()+60000,state:cap.effect==='read'?'ready':grant?'approved':'awaiting-approval',grantId:grant?.id||null,decision:grant?'always':null};
    this.data.actions.push(a);await this.save();return copy(a);
  });}
  async decide(id,decision){return this.queue(async()=>{const a=this.get(id);if(a.state!=='awaiting-approval')throw reject('Action is no longer awaiting approval');
    if(!['once','always','decline'].includes(decision))throw reject('Invalid decision',400);
    if(decision==='decline'){a.state='declined';a.decision=decision;await this.save();return copy(a);}
    await this.fresh(a);a.decision=decision;a.state='approved';
    if(decision==='always'){const g={id:randomUUID(),scope:a.scope,projectId:a.input.projectId,documentId:a.input.documentId,adapter:a.input.adapter,operation:a.input.operation,args:copy(a.input.args),path:a.target.path,epoch:a.target.epoch,confirmation:a.preview.confirmation,createdAt:this.now()};this.data.grants.push(g);a.grantId=g.id;}
    await this.save();return copy(a);
  });}
  async execute(id){return this.queue(async()=>{const a=this.get(id);if(terminalStates.has(a.state))return copy(a);if(!['ready','approved'].includes(a.state))throw reject('Explicit approval required',403);
    try{const {adapter,cap,target}=await this.fresh(a);if(this.cancelled.has(id))throw reject('Action cancelled before execution');if(a.grantId&&(this.revoked.has(a.grantId)||!this.data.grants.some(g=>g.id===a.grantId&&g.scope===a.scope)))throw reject('Permission revoked');
      // Read-only preparation may issue a native one-use ticket. Persist it in
      // the same transaction as executing, before any mutation can be sent.
      if(typeof adapter.prepareDispatch==='function')a.dispatch=dispatchSchema.parse(await adapter.prepareDispatch(copy(target),copy(a.input),copy(a.observation),copy(a.preview)));
      const current=this.adapter(a.input);
      if(current.adapter!==adapter||digest(current.cap)!==digest(cap)||digest(await this.resolveTarget(a.input))!==digest(target)||this.now()>a.expiresAt)throw reject('Dispatch scope or capability changed during preparation');
      a.state='executing';await this.save();
      // Persistence yields too: a manifest replacement during that write must
      // not authorize dispatch against the previous product selection.
      const persistedCapability=this.adapter(a.input);
      if(persistedCapability.adapter!==adapter||digest(persistedCapability.cap)!==digest(cap)||
        digest(await this.resolveTarget(a.input))!==digest(target)||this.now()>a.expiresAt)throw reject('Dispatch scope changed while persisting the attempt');
      // Recheck after persistence: revocation/cancellation can arrive while I/O yields.
      if(this.cancelled.has(id)||(a.grantId&&this.revoked.has(a.grantId))){a.state='cancelled';a.detail='Stopped before dispatch';await this.save();return copy(a);}
      this.active.add(id);
      try {const receipt=await adapter.execute(copy(target),copy(a.input),copy(a.observation),copy(a.preview),copy(a.dispatch));
        a.receipt=receipt;const verified=await adapter.verify(copy(target),copy(a.input),copy(receipt));
        a.state=verified?.verified===true?'verified':'unknown';a.verification=verified;a.detail=this.cancelled.has(id)?'Cancellation arrived after dispatch; applied changes were not undone':a.state==='unknown'?'Outcome not verified; do not retry':'Verified by adapter';
      }catch(e){a.state='unknown';a.detail='Execution may have applied: '+e.message;}
      finally{this.active.delete(id);}
      await this.save();return copy(a);
    }catch(e){if(a.state==='executing'||this.broken){a.state='unknown';a.detail='Persistence or dispatch outcome uncertain';}else{a.state='failed';a.detail=e.message;}if(!this.broken)await this.save();if(this.broken)throw e;return copy(a);}
  });}
  async revoke(grantId){this.revoked.add(grantId);return this.queue(async()=>{this.data.grants=this.data.grants.filter(g=>g.id!==grantId);for(const a of this.data.actions)if(a.grantId===grantId&&a.state==='approved'){a.state='cancelled';a.detail='Permission revoked before dispatch';}await this.save();return {revoked:true,undo:false};});}
  async cancel(id){const a=this.get(id);this.cancelled.add(id);if(this.active.has(id))return {id,state:'cancellation-requested',detail:'Already dispatched; cancellation cannot promise undo or stop the native call'};
    return this.queue(async()=>{if(!terminalStates.has(a.state)){a.state='cancelled';a.detail='Stopped before dispatch';await this.save();}return copy(a);});
  }
  async inspect(id){return this.queue(async()=>{const a=this.get(id);const adapter=this.adapters.get(a.input.adapter);const target=await this.resolveTarget(a.input);if(digest(target)!==digest(a.target))throw reject('Recovery target changed');const result=await adapter.inspect(copy(target),copy(a));a.recovery={at:this.now(),result};await this.save();return copy(a);});}
  async recoverySnapshot(a){
    if(a.state!=='unknown'||a.reconciliation)throw reject('Action does not need recovery review');
    const {adapter,cap}=this.adapter(a.input),target=targetSchema.parse(await this.resolveTarget(a.input));
    if(cap.effect!==a.effect||digest(adapter.validate(a.input.operation,a.input.args))!==digest(a.input.args))throw reject('Recovery capability or arguments changed');
    if(digest(target)!==digest(a.target))throw reject('Recovery target changed');
    if(typeof adapter.reviewRecovery!=='function')throw reject('Adapter cannot establish a reviewed recovery state',422);
    const capabilityDigest=digest(cap),targetDigest=digest(target);
    const inspection=recoveryInspectionSchema.parse(await adapter.reviewRecovery(copy(target),copy(a)));
    if(Buffer.byteLength(JSON.stringify(inspection),'utf8')>16384)throw reject('Recovery inspection too large');
    if(inspection.basis==='read-only-operation'&&(a.effect!=='read'||cap.effect!=='read'))throw reject('Recovery effect mismatch');
    if(digest(await this.resolveTarget(a.input))!==digest(target))throw reject('Recovery target changed during inspection');
    const current=this.adapter(a.input);
    if(current.adapter!==adapter||digest(current.cap)!==capabilityDigest||
      digest(adapter.validate(a.input.operation,a.input.args))!==digest(a.input.args))throw reject('Recovery capability changed during inspection');
    return {inspection,capabilityDigest,targetDigest,fingerprint:digest({inspection,capabilityDigest,targetDigest})};
  }
  async reviewRecovery(id){return this.queue(async()=>{
    const a=this.get(id),snapshot=await this.recoverySnapshot(a);
    a.recoveryReview={id:randomUUID(),at:this.now(),expiresAt:this.now()+60000,...snapshot};
    a.recovery={at:this.now(),result:copy(snapshot.inspection)};
    await this.save();return copy(a);
  });}
  async reconcile(id,raw){return this.queue(async()=>{
    const decision=recoveryDecisionSchema.parse(raw),a=this.get(id),review=a.recoveryReview;
    if(!review||review.id!==decision.reviewId||review.fingerprint!==decision.expectedFingerprint||this.now()<review.at||this.now()>review.expiresAt)throw reject('Recovery review expired or changed; inspect again');
    const current=await this.recoverySnapshot(a);
    if(current.fingerprint!==review.fingerprint||this.now()>review.expiresAt)throw reject('Recovery state changed; inspect again');
    const sameDocument=item=>item.projectId===a.input.projectId&&item.documentId===a.input.documentId;
    const grantsRevoked=this.data.grants.filter(sameDocument).map(g=>g.id);
    grantsRevoked.forEach(grantId=>this.revoked.add(grantId));
    this.data.grants=this.data.grants.filter(g=>!sameDocument(g));
    for(const pending of this.data.actions)if(sameDocument(pending.input)&&!terminalStates.has(pending.state)){
      pending.state='expired';pending.detail='Recovery accepted current state; prepare a new action and obtain fresh approval';
    }
    a.reconciliation={at:this.now(),decision:decision.decision,note:decision.note,originalOutcome:'unknown',
      replayAuthorized:false,review:copy(review),grantsRevoked};
    delete a.recoveryReview;
    // Do not alter original state, receipt, verification or detail. This accepts
    // the inspected CURRENT state, not the outcome or success of the old action.
    await this.save();return copy(a);
  });}
}
