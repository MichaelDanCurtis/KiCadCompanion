// Explicit opt-in disposable native qualification; never imported by production.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ActionGate} from '../../server/actions.mjs';
import {KonnectModelsAdapter} from '../../server/adapters/konnect-models.mjs';
import {unpack} from '../../server/konnect.mjs';

assert.equal(process.argv[2],'--run-disposable-recovery');
assert.ok(isAbsolute(process.argv[3]));assert.equal(process.argv.length,4);
const q=JSON.parse(await readFile(process.argv[3],'utf8'));
assert.match(q.board,/^\/private\/tmp\/benchline-native-live\.[^/]+\/fixtures\/BenchlineNativeTest\.kicad_pcb$/);
assert.ok([q.binary,q.config,q.model].every(isAbsolute));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(await readFile(q.binary)),q.binarySha256);
assert.equal(sha(await readFile(q.board)),q.savedSha256);
await readFile(q.model); // Existing local model only; no download or generated asset.
assert.equal(q.footprints.length,2);assert.equal(new Set(q.footprints).size,2);
const root=await mkdtemp(join(tmpdir(),'benchline-native-adapter-live-'));
const report={at:new Date().toISOString(),qualification:q,root,passed:false,productionEnabled:false,
  realNative:true,fault:'Host discards a received apply result; not a native process crash',applyCalls:0,stage:'connect'};
console.log(JSON.stringify({root,stage:report.stage}));
const client=new Client({name:'benchline-native-adapter-qualification',version:'1.0.0'});
const transport=new StdioClientTransport({command:q.binary,args:['--config',q.config],
  env:{PATH:process.env.PATH,KONNECT_ENABLE_EXPERIMENTAL_MODEL_UPDATE:'1'},stderr:'pipe'});
transport.stderr?.on('data',()=>{});
try {
  await client.connect(transport);
  const direct=async(name,args={})=>unpack(await client.callTool({name,arguments:args},undefined,{timeout:30000}));
  const catalog=await direct('list_toolboxes');assert.equal(catalog.toolsets.find(t=>t.name==='experimental_models')?.tool_count,5);
  await direct('load_toolset',{name:'experimental_models'});
  const k={tools:(await client.listTools()).tools,call:async(name,args)=>{
    if(name==='experimental_apply_placed_models'){
      report.applyCalls++;assert.ok(report.applyCalls<=2,'Never retry an uncertain native write');
    }
    return direct(name,args);
  }};
  const target={projectId:randomUUID(),documentId:randomUUID(),path:q.board,epoch:randomUUID(),manifestHash:'disposable-native-adapter'};
  const adapter=new KonnectModelsAdapter({connection:async()=>k,expectedIpcAddress:q.ipc,nativeInstance:q.nativeInstance,enabled:true});
  const input=models=>({projectId:target.projectId,documentId:target.documentId,adapter:'native-models',operation:'set-placed-models',
    args:{replacements:q.footprints.map(footprint=>({footprint,models}))},mode:'agent',idempotencyKey:randomUUID()});
  const baseline=input([]);
  const before=await adapter.snapshot(target,baseline);report.before=before.snapshot;
  assert.equal(before.snapshot.revision,q.initialRevision);
  assert.ok(before.snapshot.before.every(r=>r.models.length===0),'Disposable starting models must be empty');
  const options={path:join(root,'actions.json'),adapters:new Map([['native-models',adapter]]),resolveTarget:async()=>structuredClone(target)};
  let gate=new ActionGate(options);await gate.init();
  const change=input([{filename:q.model,scale:{x:1,y:1,z:1},rotation:{x:0,y:0,z:0},offset:{x:0,y:0,z:0},visible:true,opacity:1}]);
  report.stage='approved-apply-with-host-response-loss';
  const action=await gate.prepare(change);await gate.decide(action.id,'once');
  const execute=adapter.execute.bind(adapter);
  adapter.execute=async(...args)=>{await execute(...args);throw Error('Qualification: received native result deliberately discarded');};
  report.unknown=await gate.execute(action.id);assert.equal(report.unknown.state,'unknown');assert.equal(report.applyCalls,1);
  adapter.execute=execute;
  await assert.rejects(gate.prepare({...change,idempotencyKey:randomUUID()}),/uncertain/);
  report.stage='journal-reload-and-current-state-review';
  gate=new ActionGate(options);await gate.init();
  const review=await gate.reviewRecovery(action.id);report.review=review.recoveryReview;
  assert.equal(review.recoveryReview.inspection.basis,'postcondition-observed');
  report.reconciliation=await gate.reconcile(action.id,{reviewId:review.recoveryReview.id,
    expectedFingerprint:review.recoveryReview.fingerprint,decision:'accept-current-state',
    note:'Disposable test operator reviewed both expected model lists; original result remains unknown.'});
  assert.equal(report.reconciliation.state,'unknown');assert.equal(report.reconciliation.replayAuthorized,undefined);
  assert.equal(report.reconciliation.reconciliation.replayAuthorized,false);
  await gate.execute(action.id);assert.equal(report.applyCalls,1);
  report.stage='separately-reviewed-restoration';
  const restore=await gate.prepare(baseline);
  assert.equal(restore.observation.revision,review.recoveryReview.inspection.revision,'Unexpected intervening native edit');
  await gate.decide(restore.id,'once');report.restoration=await gate.execute(restore.id);
  assert.equal(report.restoration.state,'verified');assert.equal(report.applyCalls,2);
  const after=await adapter.snapshot(target,baseline);report.after=after.snapshot;
  // Native revision includes edit_epoch/timestamp. An ABA content restoration
  // must NOT revive the old revision or its approvals.
  assert.notEqual(after.snapshot.revision,before.snapshot.revision,'Restoration must invalidate old revisions');
  assert.deepEqual(after.snapshot.before,before.snapshot.before);
  const stable=await adapter.snapshot(target,baseline);
  assert.equal(stable.snapshot.revision,after.snapshot.revision,'Read-only observation must be stable');
  assert.equal(sha(await readFile(q.board)),q.savedSha256,'No file save is authorized');
  assert.equal(gate.list(target.projectId).grants.length,0);
  report.modelRestorationVerified=true;report.savedFileUnchanged=true;
  report.wholeUnsavedBoardPreservationVerified=false;
  report.limitations=['Selected model lists and unchanged saved file, not full unsaved native serialization preservation',
    'Journal object reload with same MCP process, not native disconnect or actual host-process kill',
    'Test-operator decisions, not UI/human approval; production remains disabled'];
  report.passed=true;report.stage='verified-restored';
} catch(error) {report.error=error.message;process.exitCode=1;}
finally {
  await client.close();
  await writeFile(join(root,'receipt.json'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({passed:report.passed,stage:report.stage,applyCalls:report.applyCalls,error:report.error,receipt:join(root,'receipt.json')}));
}
