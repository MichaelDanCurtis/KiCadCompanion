// Explicit isolated live test. No save, raw CAD write, automatic retry or undo.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ActionGate} from '../../server/actions.mjs';
import {openNativeModelFixture,fixtureInput,fixtureModel,sha} from './native-model-fixture.mjs';
import {assertModelOnlyPreserved} from './native-diagnostic-compare.mjs';

assert.equal(process.argv[2],'--run-disposable-unsaved-preservation');assert.equal(process.argv.length,4);
assert.ok(isAbsolute(process.argv[3]));const q=JSON.parse(await readFile(process.argv[3],'utf8'));assert.equal(q.diagnostic,true);
const root=await mkdtemp(join(tmpdir(),'benchline-native-preservation-'));
const report={at:new Date().toISOString(),root,passed:false,productionEnabled:false,stage:'diagnostic-preflight'};
const target={projectId:randomUUID(),documentId:randomUUID(),path:q.board,epoch:randomUUID(),manifestHash:'disposable-preservation'};
await writeFile(join(root,'context.json'),JSON.stringify({qualification:q,target}),{flag:'wx',mode:0o600});
let f;
try{
  f=await openNativeModelFixture(q);report.before=await f.diagnostic();
  assert.equal(report.before.native_instance,q.nativeInstance);assert.equal(report.before.inputs.filename,q.board);
  assert.deepEqual(await f.diagnostic(),report.before,'Read-only capture must be stable');
  const input=fixtureInput(q,target,[fixtureModel(q)]);
  const baseline=(await f.adapter.snapshot(target,input)).snapshot;
  assert.equal(baseline.revision,report.before.revision);assert.ok(baseline.before.every(i=>i.models.length===0));
  const adapters=new Map([['native-models',f.adapter]]);
  const gate=new ActionGate({path:join(root,'actions.json'),adapters,resolveTarget:async()=>structuredClone(target)});await gate.init();
  const a=await gate.prepare(input);await gate.decide(a.id,'once');
  report.stage='approved-apply';report.action=await gate.execute(a.id);assert.equal(report.action.state,'verified');
  assert.equal(f.calls(),1);report.changed=await f.diagnostic();
  report.preservation=assertModelOnlyPreserved(report.before,report.changed,q.footprints);
  assert.notEqual(report.before.revision,report.changed.revision);
  assert.equal(report.changed.revision,report.action.verification.revision);
  assert.equal(sha(await readFile(q.board)),q.savedSha256,'No save may occur during unsaved-state verification');
  await f.close();f=await openNativeModelFixture(q);adapters.set('native-models',f.adapter);
  assert.deepEqual(await f.diagnostic(),report.changed,'Reconnect must observe the same unsaved state');
  report.stage='new-approved-restoration';
  const restore=await gate.prepare(fixtureInput(q,target,[]));await gate.decide(restore.id,'once');
  report.restoration=await gate.execute(restore.id);assert.equal(report.restoration.state,'verified');assert.equal(f.calls(),1);
  report.after=await f.diagnostic();report.restoredPreservation=assertModelOnlyPreserved(report.before,report.after,q.footprints);
  assert.deepEqual(report.after.inputs.native_models,report.before.inputs.native_models);
  assert.equal(report.after.inputs.board_content,report.before.inputs.board_content,'Full serialized unsaved board must return byte-for-byte');
  assert.deepEqual(await f.diagnostic(),report.after);assert.equal(sha(await readFile(q.board)),q.savedSha256);
  assert.equal(gate.list(target.projectId).grants.length,0);report.totalApplyCalls=2;report.passed=true;report.stage='restored';
  report.limitations=['Real native serialization/settings/model inputs; unexported transient/editor state remains outside this observation',
    'Scripted test operator and fixed target; no browser or production registration qualification'];
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await f?.close();await writeFile(join(root,'receipt.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({passed:report.passed,stage:report.stage,error:report.error,receipt:join(root,'receipt.json')}));}
