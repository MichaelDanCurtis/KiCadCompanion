import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ActionGate} from '../server/actions.mjs';
import {FixtureAdapter} from '../server/adapters/fixture.mjs';
import {KonnectAdapter} from '../server/adapters/konnect.mjs';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'benchline-recovery-')),adapter=new FixtureAdapter();
  const target={projectId:randomUUID(),documentId:randomUUID(),path:join(root,'fixture.txt'),epoch:randomUUID(),manifestHash:'initial'};
  const config={path:join(root,'actions.json'),adapters:new Map([['fixture',adapter]]),resolveTarget:async()=>structuredClone(target)};
  const gate=new ActionGate(config);await gate.init();
  const input=()=>({projectId:target.projectId,documentId:target.documentId,adapter:'fixture',operation:'set-label',
    args:{value:'Reviewed value'},mode:'agent',idempotencyKey:randomUUID()});
  const action=await gate.prepare(input());await gate.decide(action.id,'always');
  const pending=await gate.prepare(input());
  const execute=adapter.execute.bind(adapter);
  adapter.execute=async(...args)=>{await execute(...args);throw Error('Lost response after apply');};
  assert.equal((await gate.execute(action.id)).state,'unknown');adapter.execute=execute;
  const decision=review=>({reviewId:review.recoveryReview.id,expectedFingerprint:review.recoveryReview.fingerprint,
    decision:'accept-current-state',note:'Reviewed the current fixture value and its revision.'});
  return {root,adapter,target,config,gate,input,action,pending,decision};
}

test('recovery accepts current state, retains unknown evidence, revokes grants and never replays',async()=>{
  const f=await fixture(),before=structuredClone(f.gate.get(f.action.id));
  await assert.rejects(f.gate.prepare(f.input()),/uncertain/);
  const review=await f.gate.reviewRecovery(f.action.id);assert.equal(review.state,'unknown');
  await assert.rejects(f.gate.prepare(f.input()),/uncertain/);
  const result=await f.gate.reconcile(f.action.id,f.decision(review));
  assert.equal(result.state,'unknown');assert.equal(result.detail,before.detail);
  assert.deepEqual(result.receipt,before.receipt);assert.deepEqual(result.verification,before.verification);
  assert.equal(result.reconciliation.originalOutcome,'unknown');assert.equal(result.reconciliation.replayAuthorized,false);
  assert.equal(result.reconciliation.grantsRevoked.length,1);
  assert.equal(f.gate.get(f.pending.id).state,'expired');assert.equal(f.gate.list(f.target.projectId).grants.length,0);
  assert.equal((await f.gate.execute(f.action.id)).state,'unknown');assert.equal(f.adapter.calls,1);
  const next=await f.gate.prepare(f.input());assert.equal(next.state,'awaiting-approval');
  await assert.rejects(f.gate.execute(next.id),/approval/);assert.equal(f.adapter.calls,1);
  await assert.rejects(f.gate.reconcile(f.action.id,f.decision(review)),/expired|changed/);
});

test('already-prepared work is blocked while another action has an unresolved outcome',async()=>{
  const f=await fixture();assert.equal((await f.gate.execute(f.pending.id)).state,'failed');assert.equal(f.adapter.calls,1);
  assert.match(f.gate.get(f.pending.id).detail,/uncertain/);
});

test('review rejects forged, missing, expired and broadened decisions without unblocking',async()=>{
  const f=await fixture();await assert.rejects(f.gate.reconcile(f.action.id,{}));
  const r=await f.gate.reviewRecovery(f.action.id),valid=f.decision(r);
  for(const change of [{reviewId:randomUUID()},{expectedFingerprint:'f'.repeat(64)},{decision:'verified'},
    {note:' '},{note:'x'.repeat(1001)},{mode:'agent'},{replay:true}])await assert.rejects(f.gate.reconcile(f.action.id,{...valid,...change}));
  f.gate.get(f.action.id).recoveryReview.expiresAt=0;
  await assert.rejects(f.gate.reconcile(f.action.id,valid),/expired/);
  assert.equal(f.gate.get(f.action.id).reconciliation,undefined);assert.equal(f.adapter.calls,1);
});

test('changed native state, capability, identity or unavailable inspection requires a new review',async()=>{
  for(const drift of ['revision','value','capability','target','disconnect','unsupported']){
    const f=await fixture(),r=await f.gate.reviewRecovery(f.action.id);
    if(drift==='revision')f.adapter.revision++;
    if(drift==='value')f.adapter.value='Manual edit';
    if(drift==='capability'){const caps=f.adapter.capabilities();caps[0].version++;f.adapter.capabilities=()=>caps;}
    if(drift==='target')f.target.epoch=randomUUID();
    if(drift==='disconnect')f.adapter.connected=false;
    if(drift==='unsupported')f.adapter.reviewRecovery=undefined;
    await assert.rejects(f.gate.reconcile(f.action.id,f.decision(r)));
    assert.equal(f.gate.get(f.action.id).reconciliation,undefined);assert.equal(f.adapter.calls,1);
  }
});

test('restart invalidates pending recovery consent but retains completed reconciliation',async()=>{
  const f=await fixture(),r=await f.gate.reviewRecovery(f.action.id);
  const restarted=new ActionGate(f.config);await restarted.init();
  assert.ok(restarted.get(f.action.id).recovery);assert.equal(restarted.get(f.action.id).recoveryReview,undefined);
  await assert.rejects(restarted.reconcile(f.action.id,f.decision(r)),/expired/);
  const fresh=await restarted.reviewRecovery(f.action.id);await restarted.reconcile(f.action.id,f.decision(fresh));
  const again=new ActionGate(f.config);await again.init();
  assert.equal(again.get(f.action.id).state,'unknown');assert.ok(again.get(f.action.id).reconciliation);
  assert.equal((await again.prepare(f.input())).state,'awaiting-approval');
  assert.equal((await again.execute(f.action.id)).state,'unknown');assert.equal(f.adapter.calls,1);
});

test('capability drift during asynchronous recovery inspection cannot accept current state',async()=>{
  for(const drift of ['version','unsupported','replacement','arguments']){
    const f=await fixture(),r=await f.gate.reviewRecovery(f.action.id);
    const inspect=f.adapter.reviewRecovery.bind(f.adapter),caps=f.adapter.capabilities();
    f.adapter.capabilities=()=>caps;
    f.adapter.reviewRecovery=async(...args)=>{
      const result=await inspect(...args);
      if(drift==='version')caps[0].version++;
      if(drift==='unsupported')caps[0].supported=false;
      if(drift==='replacement')f.config.adapters.set('fixture',new FixtureAdapter());
      if(drift==='arguments')f.adapter.validate=()=>({value:'Changed arguments'});
      return result;
    };
    await assert.rejects(f.gate.reconcile(f.action.id,f.decision(r)));
    assert.equal(f.gate.get(f.action.id).reconciliation,undefined);
    assert.equal(f.gate.list(f.target.projectId).grants.length,1);
    assert.equal(f.adapter.calls,1);
  }
});

test('failed reconciliation persistence poisons the gate and cannot silently unblock on restart',async()=>{
  const f=await fixture(),r=await f.gate.reviewRecovery(f.action.id);f.gate.path=f.root;
  await assert.rejects(f.gate.reconcile(f.action.id,f.decision(r)));assert.equal(f.gate.broken,true);
  await assert.rejects(f.gate.prepare(f.input()),/persistence/);
  const restarted=new ActionGate(f.config);await restarted.init();
  assert.equal(restarted.get(f.action.id).reconciliation,undefined);await assert.rejects(restarted.prepare(f.input()),/uncertain/);
});

test('malformed, oversized and false-effect inspection cannot create a recovery grant',async()=>{
  const f=await fixture(),original=f.adapter.reviewRecovery.bind(f.adapter);
  for(const alter of [r=>({...r,basis:'read-only-operation'}),r=>({...r,details:{large:'x'.repeat(17000)}}),r=>({...r,allowReplay:true})]){
    f.adapter.reviewRecovery=async(...args)=>alter(await original(...args));
    await assert.rejects(f.gate.reviewRecovery(f.action.id));assert.equal(f.gate.get(f.action.id).recoveryReview,undefined);
  }
  const native=new KonnectAdapter({connection:async()=>{throw Error('Must not connect');}});
  await assert.rejects(native.reviewRecovery(f.target,{effect:'write',input:{operation:'refresh-footprints'}}),/unsupported/);
});
