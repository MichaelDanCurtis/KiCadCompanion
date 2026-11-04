import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ActionGate,digest} from '../server/actions.mjs';
import {KonnectModelsAdapter} from '../server/adapters/konnect-models.mjs';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'benchline-native-adapter-'));
  const target={projectId:randomUUID(),documentId:randomUUID(),path:join(root,'disposable.kicad_pcb'),epoch:randomUUID(),manifestHash:'initial'};
  const instance=randomUUID(),ipc='ipc:///private/tmp/benchline-adapter-test.sock',footprint=randomUUID();
  const replacement={footprint,models:[{filename:'test.step',scale:{x:1,y:1,z:1},rotation:{x:0,y:0,z:0},offset:{x:0,y:0,z:0},visible:true,opacity:1}]};
  const state={instance,revision:1,models:[{footprint,models:[]}],calls:0,ticket:null,receipt:null,connected:true,drift:false,loseResponse:false};
  const revision=()=>digest({revision:state.revision,models:state.models});
  let gate;
  const k={tools:['open_project','experimental_get_model_context','experimental_preview_placed_models',
    'experimental_apply_placed_models','experimental_inspect_model_result'].map(name=>({name})),
  async call(name,args){
    if(!state.connected)throw Error('Disconnected');
    if(name==='open_project')return {ipc_address:ipc,ipc_available:true,kicad_ui_running:true,requested_open:true,
      requested_path:target.path,requested_board:target.path,requested_check_error:null,open_boards_error:null,
      open_board_count:1,open_boards:[target.path]};
    if(name==='experimental_get_model_context')return {experimental:true,native_instance:state.instance,board:target.path,
      source:'ipc',approval_granted:false,revision_verified:false};
    if(name==='experimental_preview_placed_models'){
      assert.equal(args.native_instance,state.instance);assert.equal(args.board,target.path);
      state.ticket={token:randomUUID(),revision:revision(),operation:digest(args)};
      return {experimental:true,...{token:state.ticket.token,revision:state.ticket.revision},expires_in_seconds:120,
        before:structuredClone(state.models),approval_granted:false};
    }
    if(name==='experimental_apply_placed_models'){
      state.calls++;
      // This must already be durable, even if the response is subsequently lost.
      const journal=JSON.parse(await readFile(gate.path,'utf8'));
      const active=journal.actions.find(a=>a.state==='executing');
      assert.equal(active.dispatch.token,args.token);
      if(state.drift)state.revision++;
      const ticket=state.ticket;state.ticket=null;
      assert.equal(ticket.token,args.token);assert.equal(ticket.operation,digest(args.operation));
      if(ticket.revision!==revision())throw Error('Native stale refusal');
      state.models=structuredClone(args.operation.replacements);state.revision++;
      state.receipt={experimental:true,token:args.token,outcome:'MU_APPLIED',detail:'fixture native result',state_verified:false,retry_authorized:false};
      if(state.loseResponse)throw Error('Response lost after apply');
      return structuredClone(state.receipt);
    }
    if(name==='experimental_inspect_model_result')return state.receipt??{experimental:true,token:args.token,outcome:'MU_UNKNOWN',detail:'unavailable',state_verified:false,retry_authorized:false};
    throw Error('Unexpected MCP call');
  }};
  const adapter=new KonnectModelsAdapter({connection:async()=>k,expectedIpcAddress:ipc,nativeInstance:instance,enabled:true});
  const options={path:join(root,'actions.json'),adapters:new Map([['native-models',adapter]]),resolveTarget:async()=>structuredClone(target)};
  gate=new ActionGate(options);await gate.init();
  const input=()=>({projectId:target.projectId,documentId:target.documentId,adapter:'native-models',operation:'set-placed-models',
    args:{replacements:[structuredClone(replacement)]},mode:'agent',idempotencyKey:randomUUID()});
  return {root,target,state,adapter,k,options,input,gate,instance,ipc,replacement,setGate:value=>{gate=value;}};
}

test('candidate defaults disabled, refuses Discuss and strict model argument failures',async()=>{
  const f=await fixture();
  const disabled=new KonnectModelsAdapter({connection:async()=>f.k,expectedIpcAddress:f.ipc,nativeInstance:f.instance});
  assert.equal(disabled.capabilities()[0].supported,false);
  await assert.rejects(disabled.observe(f.target,f.input()),/unavailable/);
  await assert.rejects(f.gate.prepare({...f.input(),mode:'discuss'}),/Discuss/);
  for(const alter of [a=>({...a,board:'/other'}),a=>({...a,replacements:[...a.replacements,...a.replacements]}),
    a=>{a.replacements[0].models[0].opacity=2;return a;},a=>{a.replacements[0].models[0].scale.x=0;return a;},
    a=>{a.replacements[0].models[0].filename='bad\0path';return a;}]){
    const i=f.input();i.args=alter(i.args);await assert.rejects(f.gate.prepare(i));
  }
  assert.equal(f.state.calls,0);
});

test('durable one-use dispatch, independent verification and bounded recurring scope',async()=>{
  const f=await fixture(),a=await f.gate.prepare(f.input());
  assert.equal(a.state,'awaiting-approval');await f.gate.decide(a.id,'always');
  const result=await f.gate.execute(a.id);
  assert.equal(result.state,'verified');assert.ok(result.dispatch.token);assert.equal(f.state.calls,1);
  assert.equal((await f.gate.execute(a.id)).state,'verified');assert.equal(f.state.calls,1);
  assert.equal((await f.gate.prepare(f.input())).state,'approved');
  const changed=f.input();changed.args.replacements[0].models[0].opacity=0.5;
  assert.equal((await f.gate.prepare(changed)).state,'awaiting-approval');
});

test('wrong editor, disconnected endpoint, missing tool and stale revision refuse before apply',async()=>{
  for(const kind of ['instance','disconnect','tool','revision']){
    const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'once');
    if(kind==='instance')f.state.instance=randomUUID();
    if(kind==='disconnect')f.state.connected=false;
    if(kind==='tool')f.k.tools.pop();
    if(kind==='revision')f.state.revision++;
    assert.equal((await f.gate.execute(a.id)).state,'failed');assert.equal(f.state.calls,0);
  }
});

test('revision drift in final native window is unknown, blocked and never replayed',async()=>{
  const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'once');f.state.drift=true;
  assert.equal((await f.gate.execute(a.id)).state,'unknown');assert.equal(f.state.models[0].models.length,0);
  await assert.rejects(f.gate.prepare(f.input()),/uncertain/);
  await f.gate.execute(a.id);assert.equal(f.state.calls,1);
});

test('lost native response survives restart; current-state reconciliation never changes unknown outcome',async()=>{
  const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'always');f.state.loseResponse=true;
  assert.equal((await f.gate.execute(a.id)).state,'unknown');
  const restarted=new ActionGate(f.options);await restarted.init();f.setGate(restarted);
  const review=await restarted.reviewRecovery(a.id);
  assert.equal(review.recoveryReview.inspection.basis,'postcondition-observed');
  const done=await restarted.reconcile(a.id,{reviewId:review.recoveryReview.id,expectedFingerprint:review.recoveryReview.fingerprint,
    decision:'accept-current-state',note:'Inspected current model lists.'});
  assert.equal(done.state,'unknown');assert.equal(done.reconciliation.replayAuthorized,false);
  assert.equal(restarted.list(f.target.projectId).grants.length,0);
  assert.equal((await restarted.prepare(f.input())).state,'awaiting-approval');assert.equal(f.state.calls,1);
});

test('unavailable MCP receipt requires fresh native state; it never implies apply success or replay',async()=>{
  for(const snapshotAvailable of [true,false]){
    const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'once');f.state.loseResponse=true;
    assert.equal((await f.gate.execute(a.id)).state,'unknown');
    const call=f.k.call.bind(f.k);
    f.k.call=async(name,args)=>{
      // Real Konnect marks MU_UNKNOWN as isError and unpack rejects that reply.
      if(name==='experimental_inspect_model_result')throw Error('MCP receipt unavailable for new client');
      if(name==='experimental_preview_placed_models'&&!snapshotAvailable)throw Error('Fresh observation failed');
      return call(name,args);
    };
    if(snapshotAvailable){
      const review=await f.gate.reviewRecovery(a.id);
      assert.equal(review.recoveryReview.inspection.details.receiptOutcome,'unavailable');
      assert.equal(review.recoveryReview.inspection.basis,'postcondition-observed');
      assert.equal(f.gate.get(a.id).state,'unknown');
      await assert.rejects(f.gate.prepare(f.input()),/uncertain/);
    }else{
      await assert.rejects(f.gate.reviewRecovery(a.id),/Fresh observation failed/);
      assert.equal(f.gate.get(a.id).recoveryReview,undefined);
    }
    await f.gate.execute(a.id);assert.equal(f.state.calls,1);
  }
});

test('changed state or native instance prevents accepting an old recovery review',async()=>{
  for(const drift of ['revision','instance','models']){
    const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'once');f.state.loseResponse=true;
    await f.gate.execute(a.id);const review=await f.gate.reviewRecovery(a.id);
    if(drift==='revision')f.state.revision++;
    if(drift==='instance')f.state.instance=randomUUID();
    if(drift==='models')f.state.models[0].models[0].filename='manual.step';
    await assert.rejects(f.gate.reconcile(a.id,{reviewId:review.recoveryReview.id,expectedFingerprint:review.recoveryReview.fingerprint,
      decision:'accept-current-state',note:'Old review must not be accepted.'}));
    assert.equal(f.gate.get(a.id).reconciliation,undefined);assert.equal(f.state.calls,1);
  }
});

test('dispatch preparation persistence failure and cancellation cannot send native writes',async()=>{
  for(const failure of ['persist','cancel','oversize']){
    const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'once');
    const original=f.adapter.prepareDispatch.bind(f.adapter);
    f.adapter.prepareDispatch=async(...args)=>{const value=await original(...args);
      if(failure==='persist')f.gate.path=f.root;
      if(failure==='cancel')void f.gate.cancel(a.id);
      return failure==='oversize'?{large:'x'.repeat(33000)}:value;
    };
    if(failure==='persist')await assert.rejects(f.gate.execute(a.id));
    else assert.equal((await f.gate.execute(a.id)).state,failure==='cancel'?'cancelled':'failed');
    assert.equal(f.state.calls,0);
  }
});

test('unverified native postcondition stays unknown even with an applied receipt',async()=>{
  const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'once');
  const execute=f.adapter.execute.bind(f.adapter);
  f.adapter.execute=async(...args)=>{const result=await execute(...args);f.state.models[0].models[0].opacity=0.1;return result;};
  assert.equal((await f.gate.execute(a.id)).state,'unknown');assert.equal(f.state.calls,1);
});

test('project identity and capability drift during ticket preparation blocks native dispatch',async()=>{
  for(const kind of ['target','capability']){
    const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'once');
    const prepare=f.adapter.prepareDispatch.bind(f.adapter);
    f.adapter.prepareDispatch=async(...args)=>{const value=await prepare(...args);
      if(kind==='target')f.target.manifestHash='changed';else f.adapter.enabled=false;
      return value;
    };
    assert.equal((await f.gate.execute(a.id)).state,'failed');assert.equal(f.state.calls,0);
  }
});

test('scope replacement during dispatch persistence never sends the prepared native ticket',async()=>{
  const f=await fixture(),a=await f.gate.prepare(f.input());await f.gate.decide(a.id,'once');
  const save=f.gate.save.bind(f.gate);
  f.gate.save=async()=>{await save();if(f.gate.get(a.id).state==='executing')f.target.manifestHash='replaced-during-save';};
  assert.equal((await f.gate.execute(a.id)).state,'unknown');
  assert.equal(f.state.calls,0);assert.equal(f.state.models[0].models.length,0);
});
