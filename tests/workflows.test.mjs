import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkflowStore} from '../server/workflows.mjs';

const task=(overrides={})=>({id:randomUUID(),title:'Inspect input',adapter:'fixture',dependencies:[],documents:['fixture-document'],
  inputs:{source:'revision-1'},acceptance:[{id:'A1',description:'Observed input matches'}],params:{},...overrides});
const plan=tasks=>({id:randomUUID(),projectId:randomUUID(),title:'Disposable plan',tasks});
const evidence=(passed=true)=>[{criterion:'A1',locator:'fixture://receipt',revision:'revision-1',summary:'Observed result',passed}];
async function setup(t,adapter={execute:async()=>({text:'final message'}),verify:async()=>evidence()}) {
  const root=await mkdtemp(join(tmpdir(),'benchline-workflows-'));let store;let observed={source:'revision-1'};
  const options={path:join(root,'workflows.sqlite'),adapters:new Map([['fixture',adapter]]),observeInputs:async()=>observed};
  store=new WorkflowStore(options);t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});
  return {get store(){return store;},set observed(value){observed=value;},root,options,
    reopen:async()=>{await store.close();store=new WorkflowStore(options);return store;}};
}
test('durable DAG completes only with every current acceptance item, not final text',async t=>{
  const f=await setup(t,{execute:async()=>({text:'All done!'}),verify:async()=>[]}),a=task(),p=plan([a]);
  f.store.create(p,'create');f.store.activate(p.id,'activate');
  const result=await f.store.run(a.id,{requestId:'run'});assert.equal(result.tasks[0].state,'failed');
  const reopened=await f.reopen();assert.equal(reopened.get(p.id).tasks[0].attempts[0].output.text,'All done!');
  assert.equal(reopened.get(p.id).tasks[0].state,'failed');
});
test('partial, failed and unrecognized acceptance evidence never completes a task',async t=>{
  for(const kind of ['partial','failed','unrecognized'])await t.test(kind,async t=>{
    const records=kind==='partial'?evidence():kind==='failed'?[...evidence(),{...evidence(false)[0],criterion:'A2'}]:[{...evidence()[0],criterion:'invented'}];
    const f=await setup(t,{execute:async()=>({message:'verified'}),verify:async()=>records});
    const a=task({acceptance:[{id:'A1',description:'First item'},{id:'A2',description:'Second item'}]}),p=plan([a]);
    f.store.create(p,'create');f.store.activate(p.id,'activate');const result=await f.store.run(a.id,{requestId:'run'});
    assert.equal(result.tasks[0].state,kind==='unrecognized'?'verifying':'failed');
  });
});
test('idempotent requests execute once; collisions fail and historical requests never replay',async t=>{
  let writes=0;const f=await setup(t,{execute:async()=>({count:++writes}),verify:async()=>evidence()});
  const a=task(),p=plan([a]);f.store.create(p,'create');f.store.create(p,'create');f.store.activate(p.id,'activate');
  await Promise.all([f.store.run(a.id,{requestId:'run'}),f.store.run(a.id,{requestId:'run'})]);assert.equal(writes,1);
  await f.reopen();await f.store.run(a.id,{requestId:'run'});assert.equal(writes,1);
  assert.equal(f.store.get(p.id).tasks[0].state,'completed');
  assert.throws(()=>f.store.create({...p,title:'Different'},'create'),/different work/);
  await assert.rejects(f.store.run(a.id,{requestId:'run',approvalRef:'changed'}),/different work/);
});
test('cycles reject atomically, failed prerequisites block, independent tasks continue',async t=>{
  const f=await setup(t,{execute:async({task})=>({fail:task.params.fail}),verify:async({output})=>evidence(!output.fail)});
  const a=task({params:{fail:true}}),b=task({documents:['second'],dependencies:[a.id]}),c=task({documents:['third']});
  const cyclic=plan([{...a,dependencies:[b.id]},b]);assert.throws(()=>f.store.create(cyclic,'cycle'),/cycle/);
  assert.equal(f.store.list(cyclic.projectId).length,0);
  const p=plan([a,b,c]);f.store.create(p,'create');f.store.activate(p.id,'activate');await f.store.run(a.id,{requestId:'a'});
  await assert.rejects(f.store.run(b.id,{requestId:'b'}),/not ready/);await f.store.run(c.id,{requestId:'c'});
  const states=f.store.get(p.id).tasks.map(t=>t.state);assert.deepEqual(states,['failed','proposed','completed']);
  assert.match(f.store.get(p.id).tasks[1].reason,/failed/);
});
test('manual input changes invalidate downstream evidence and preserve success history',async t=>{
  const f=await setup(t),a=task(),b=task({dependencies:[a.id],documents:['other'],inputs:{}}),p=plan([a,b]);
  f.store.create(p,'create');f.store.activate(p.id,'activate');await f.store.run(a.id,{requestId:'a'});await f.store.run(b.id,{requestId:'b'});
  f.observed={source:'revision-2'};const result=await f.store.refresh(p.id);
  assert.ok(result.tasks.every(t=>t.stale&&t.state==='completed'&&t.evidence.length===1&&!t.evidence[0].current));
  await f.reopen();assert.ok(f.store.get(p.id).tasks.every(t=>t.stale));
});
test('single writer remains locked during dispatch and unknown outcomes survive restart',async t=>{
  let release;const held=new Promise(resolve=>release=resolve);let entered;const started=new Promise(resolve=>entered=resolve);
  const f=await setup(t,{mutating:true,authorize:async()=>{},execute:async()=>{entered();await held;throw Error('Lost response');},verify:async()=>evidence()});
  const a=task(),b=task(),p=plan([a,b]);f.store.create(p,'create');f.store.activate(p.id,'activate');
  const running=f.store.run(a.id,{requestId:'a',approvalRef:'scoped-fixture-action'});await started;
  await assert.rejects(f.store.run(b.id,{requestId:'b',approvalRef:'scoped-fixture-action'}),/UNIQUE/);
  release();await running;assert.equal(f.store.get(p.id).tasks[0].state,'unknown-outcome');
  await f.reopen();await assert.rejects(f.store.run(b.id,{requestId:'b',approvalRef:'scoped-fixture-action'}),/UNIQUE/);
  assert.equal(f.store.get(p.id).tasks[1].attempts.length,0);
});
test('a second store cannot recover a live owner, and graceful close drains verification',async t=>{
  let release,entered;const hold=new Promise(r=>release=r),start=new Promise(r=>entered=r);
  const f=await setup(t,{execute:async()=>({ok:true}),verify:async()=>{entered();await hold;return evidence();}});
  assert.throws(()=>new WorkflowStore(f.options),/locked/);
  const a=task(),p=plan([a]);f.store.create(p,'create');f.store.activate(p.id,'activate');const run=f.store.run(a.id,{requestId:'run'});await start;
  let closed=false;const closing=f.store.close().then(()=>closed=true);await new Promise(r=>setImmediate(r));assert.equal(closed,false);
  assert.throws(()=>f.store.activate(p.id,'again'),/closing/);release();await run;await closing;
  await f.reopen();assert.equal(f.store.get(p.id).tasks[0].state,'completed');
});
test('SIGKILL matrix preserves proposed, approved, executing, verifying and post-write boundaries',async t=>{
  for(const boundary of ['proposed','approved','executing','verifying','post-write'])await t.test(boundary,async t=>{
    const root=await mkdtemp(join(tmpdir(),'benchline-workflow-crash-')),a=task(),p=plan([a]);let store;
    t.after(async()=>{await store?.close();await rm(root,{recursive:true,force:true});});
    await writeFile(join(root,'plan.json'),JSON.stringify(p));
    const child=spawn(process.execPath,['tests/fixtures/workflow-crash.mjs',root,boundary],{stdio:['ignore','pipe','pipe']});
    let logs='';child.stderr.on('data',b=>logs+=b);const [code,signal]=await once(child,'close');
    assert.equal(code,null,logs);assert.equal(signal,'SIGKILL');
    let executions=0,observations=0;
    const adapter={mutating:true,authorize:async()=>{},execute:async()=>{executions++;throw Error('Must not replay');},
      observe:async()=>{observations++;return boundary==='post-write'?{status:'applied',locator:'writes.txt',revision:'written-once',output:{ok:true}}:
        {status:'not-applied',locator:'writes.txt',revision:'absent'};},verify:async()=>evidence()};
    store=new WorkflowStore({path:join(root,'workflows.sqlite'),adapters:new Map([['fixture',adapter]]),observeInputs:async()=>({source:'revision-1'})});
    const expected={proposed:'proposed',approved:'interrupted',executing:'unknown-outcome',verifying:'verifying','post-write':'unknown-outcome'};
    assert.equal(store.get(p.id).tasks[0].state,expected[boundary]);
    const writes=await readFile(join(root,'writes.txt'),'utf8').catch(()=>null);
    assert.equal(writes,['verifying','post-write'].includes(boundary)?'one write\n':null);
    if(boundary!=='proposed')await store.run(a.id,{requestId:'run',approvalRef:'disposable-action-reference'});
    assert.equal(executions,0);
    if(boundary==='verifying')assert.equal((await store.resumeVerification(a.id)).tasks[0].state,'completed');
    if(['post-write','executing'].includes(boundary)) {
      assert.throws(()=>store.reviewRetry(a.id,'unsafe-retry'),/Only failed or interrupted/);
      assert.equal((await store.observeOutcome(a.id)).tasks[0].state,boundary==='post-write'?'completed':'interrupted');assert.equal(observations,1);
    }
    assert.equal(executions,0);assert.equal(await readFile(join(root,'writes.txt'),'utf8').catch(()=>null),writes);
  });
});
