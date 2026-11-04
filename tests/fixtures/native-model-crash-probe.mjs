// Explicit real-process/native test. Not run by npm test or production routes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ActionGate} from '../../server/actions.mjs';
import {openNativeModelFixture,fixtureInput,sha} from './native-model-fixture.mjs';

assert.ok(['--run-disposable-process-loss','--recover-disposable-process-loss'].includes(process.argv[2]));assert.equal(process.argv.length,4);
assert.ok(isAbsolute(process.argv[3]));
const recoverOnly=process.argv[2]==='--recover-disposable-process-loss';
const root=recoverOnly?process.argv[3]:await mkdtemp(join(tmpdir(),'benchline-native-process-loss-'));
const context=recoverOnly?JSON.parse(await readFile(join(root,'context.json'),'utf8')):null;
const q=context?.qualification??JSON.parse(await readFile(process.argv[3],'utf8'));
const target=context?.target??{projectId:randomUUID(),documentId:randomUUID(),path:q.board,epoch:randomUUID(),manifestHash:'disposable-process-loss'};
if(!recoverOnly)await writeFile(join(root,'context.json'),JSON.stringify({qualification:q,target}),{flag:'wx',mode:0o600});
const report={at:new Date().toISOString(),root,passed:false,productionEnabled:false,stage:'worker',nativeProcessKilled:false};
const receiptPath=join(root,recoverOnly?'recovery-receipt.json':'receipt.json');
// Exclusive output reservation prevents repeating recovery on this journal.
await writeFile(receiptPath,'',{flag:'wx',mode:0o600});
console.log(JSON.stringify({root,stage:report.stage}));
let f,child;
try {
  if(recoverOnly){
    const failed=JSON.parse(await readFile(join(root,'receipt.json'),'utf8'));
    assert.equal(failed.passed,false);assert.equal(failed.stage,'new-process-connection-and-journal-recovery');
    assert.equal(failed.review.inspection.basis,'postcondition-observed');
    const journal=JSON.parse(await readFile(join(root,'actions.json'),'utf8'));
    assert.equal(journal.actions.length,1);assert.equal(journal.actions[0].state,'unknown');
    assert.equal(journal.actions[0].reconciliation,undefined);
    report.workerExit=failed.workerExit;report.beforeRestart=failed.beforeRestart;
    report.previousFailedReceipt=join(root,'receipt.json');
  }else{
  child=spawn(process.execPath,[fileURLToPath(new URL('./native-model-crash-worker.mjs',import.meta.url)),
    '--crash-after-disposable-apply',root],{stdio:['ignore','pipe','pipe']});
  let diagnostics='';child.stdout.on('data',d=>{diagnostics=(diagnostics+d).slice(-12000);});
  child.stderr.on('data',d=>{diagnostics=(diagnostics+d).slice(-12000);});
  // A timeout is not permission to retry. Terminate only this known child and
  // preserve the executing journal for inspection; no automatic recovery on error.
  const timeout=setTimeout(()=>child.kill('SIGTERM'),60000);
  report.workerExit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}).finally(()=>clearTimeout(timeout));
  report.workerDiagnostics=diagnostics;
  report.beforeRestart=JSON.parse(await readFile(join(root,'actions.json'),'utf8')).actions[0];
  }
  assert.deepEqual(report.workerExit,{code:null,signal:'SIGKILL'});
  report.worker=JSON.parse(await readFile(join(root,'worker-received.json'),'utf8'));
  if(child)assert.equal(report.worker.workerPid,child.pid);
  assert.equal(report.worker.konnectExited,true);
  assert.equal(report.beforeRestart.state,'executing');assert.equal(report.beforeRestart.receipt,undefined);
  assert.equal(report.beforeRestart.dispatch.token,report.worker.token);
  report.stage='new-process-connection-and-journal-recovery';
  f=await openNativeModelFixture(q);report.newKonnectPid=f.pid;
  assert.notEqual(f.pid,report.worker.konnectPid);
  const gate=new ActionGate({path:join(root,'actions.json'),adapters:new Map([['native-models',f.adapter]]),resolveTarget:async()=>structuredClone(target)});
  await gate.init();
  const id=report.worker.actionId;
  assert.equal(gate.get(id).state,'unknown');
  await assert.rejects(gate.prepare(fixtureInput(q,target,[])),/uncertain/);
  await gate.execute(id);assert.equal(f.calls(),0);
  const review=await gate.reviewRecovery(id);report.review=review.recoveryReview;
  assert.equal(review.recoveryReview.inspection.basis,'postcondition-observed');
  // Konnect marks MU_UNKNOWN as MCP isError; unpack rejects it, so the adapter
  // reports unavailable. Recovery uses independent current-state observation.
  assert.equal(review.recoveryReview.inspection.details.receiptOutcome,'unavailable','A fresh Konnect client must not inherit another client receipt');
  report.reconciliation=await gate.reconcile(id,{reviewId:review.recoveryReview.id,expectedFingerprint:review.recoveryReview.fingerprint,
    decision:'accept-current-state',note:'Disposable test operator inspected expected models after worker termination; original outcome remains unknown.'});
  assert.equal(report.reconciliation.state,'unknown');assert.equal(report.reconciliation.reconciliation.replayAuthorized,false);
  report.stage='new-approved-restoration';
  const baseline=fixtureInput(q,target,[]),restoration=await gate.prepare(baseline);
  assert.equal(restoration.observation.revision,review.recoveryReview.inspection.revision);
  await gate.decide(restoration.id,'once');report.restoration=await gate.execute(restoration.id);
  assert.equal(report.restoration.state,'verified');assert.equal(f.calls(),1);
  report.after=(await f.adapter.snapshot(target,baseline)).snapshot;
  assert.deepEqual(report.after.before,report.worker.baseline.before);
  assert.notEqual(report.after.revision,q.initialRevision);
  assert.equal((await f.adapter.snapshot(target,baseline)).snapshot.revision,report.after.revision);
  assert.equal(sha(await readFile(q.board)),q.savedSha256);
  assert.equal(gate.list(target.projectId).grants.length,0);
  report.totalApplyCalls=report.worker.applyCalls+f.calls();assert.equal(report.totalApplyCalls,2);
  report.passed=true;report.stage='restored';
  report.limitations=['Real host SIGKILL after native reply but before gate receipt persistence; not KiCad crash or mid-native-commit disconnect',
    'Model lists restored and saved file unchanged; full unsaved-board preservation and UI acceptance remain separate'];
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await f?.close();await writeFile(receiptPath,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({passed:report.passed,stage:report.stage,error:report.error,receipt:receiptPath}));}
