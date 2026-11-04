// Explicit child of the native crash probe. Kills only itself after its sole
// private MCP child has disconnected. No save, retry or automatic restoration.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ActionGate} from '../../server/actions.mjs';
import {openNativeModelFixture,fixtureInput,fixtureModel} from './native-model-fixture.mjs';

const [flag,root]=process.argv.slice(2);
assert.equal(flag,'--crash-after-disposable-apply');assert.ok(isAbsolute(root));
const {qualification:q,target}=JSON.parse(await readFile(join(root,'context.json'),'utf8'));
const f=await openNativeModelFixture(q);
try {
  const baseline=await f.adapter.snapshot(target,fixtureInput(q,target,[]));
  assert.equal(baseline.snapshot.revision,q.initialRevision);
  assert.ok(baseline.snapshot.before.every(item=>item.models.length===0));
  const gate=new ActionGate({path:join(root,'actions.json'),adapters:new Map([['native-models',f.adapter]]),resolveTarget:async()=>structuredClone(target)});
  await gate.init();
  const action=await gate.prepare(fixtureInput(q,target,[fixtureModel(q)]));await gate.decide(action.id,'once');
  const execute=f.adapter.execute.bind(f.adapter);
  f.adapter.execute=async(...args)=>{
    const receipt=await execute(...args);
    assert.equal(f.calls(),1);
    const durable=JSON.parse(await readFile(join(root,'actions.json'),'utf8')).actions[0];
    assert.equal(durable.state,'executing');assert.equal(durable.receipt,undefined);
    assert.equal(durable.dispatch.token,receipt.dispatch.token);
    await f.close();
    let gone=false;
    for(let i=0;i<80;i++){
      try{process.kill(f.pid,0);}catch(error){if(error.code==='ESRCH'){gone=true;break;}throw error;}
      await delay(25);
    }
    assert.equal(gone,true,'Private Konnect process must close before worker termination');
    await writeFile(join(root,'worker-received.json'),JSON.stringify({workerPid:process.pid,konnectPid:f.pid,
      konnectExited:true,applyCalls:f.calls(),actionId:action.id,token:receipt.dispatch.token,
      nativeOutcome:receipt.result.outcome,baseline:baseline.snapshot},null,2),{flag:'wx',mode:0o600});
    process.kill(process.pid,'SIGKILL');
    throw Error('Expected worker SIGKILL');
  };
  await gate.execute(action.id);
  throw Error('Worker did not terminate at the required boundary');
}finally{await f.close();}
