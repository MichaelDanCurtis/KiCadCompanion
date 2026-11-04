// Explicit disposable native integration; never loaded by production or npm test.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import {ProjectStore} from '../../server/projects.mjs';
import {ActionGate} from '../../server/actions.mjs';
import {actionRoutes,projectTargetResolver} from '../../server/action-routes.mjs';
import {manifestSchema} from '../../shared/project.mjs';
import {openNativeModelFixture,fixtureInput,fixtureModel,sha} from './native-model-fixture.mjs';

assert.equal(process.argv[2],'--run-disposable-project-binding');assert.equal(process.argv.length,4);
assert.ok(isAbsolute(process.argv[3]));
const q=JSON.parse(await readFile(process.argv[3],'utf8'));
// Validate the exact disposable native paths and binary before creating metadata.
let f=await openNativeModelFixture(q),server;
const root=await mkdtemp(join(tmpdir(),'benchline-native-project-'));
const report={at:new Date().toISOString(),root,passed:false,productionEnabled:false,stage:'project-registration'};
try{
  const manifestPath=join(dirname(q.board),'benchline.project.json');
  const manifest=manifestSchema.parse({schemaVersion:1,id:randomUUID(),name:'Native model disposable project binding',
    revision:1,sourceBrief:null,requirements:[],artifacts:[{id:randomUUID(),name:'Private native board',kind:'electrical',
      path:'BenchlineNativeTest.kicad_pcb',dependsOn:[]}]});
  // Refuse to reuse or overwrite an existing manifest or previous run.
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  const projects=new ProjectStore({storageRoot:join(root,'projects'),managedRoot:join(root,'managed')});
  await projects.init();let project=await projects.openRoot(dirname(q.board));
  const resolveTarget=projectTargetResolver(projects),adapters=new Map([['native-models',f.adapter]]);
  let gate=new ActionGate({path:join(root,'actions.json'),resolveTarget,adapters});await gate.init();
  const target={projectId:manifest.id,documentId:manifest.artifacts[0].id};
  const input=()=>fixtureInput(q,target,[fixtureModel(q)]);
  const before=(await f.adapter.snapshot(await resolveTarget(input()),input())).snapshot;
  assert.ok(before.before.every(i=>i.models.length===0));report.before=before;
  const app=express();app.use(express.json({limit:'256kb'}));
  // Resolve the current gate through a proxy so restart uses the same HTTP routes.
  actionRoutes(app,new Proxy({}, {get:(_,key)=>gate[key].bind(gate)}),adapters);
  app.use((error,req,res,next)=>res.status(error.status??400).json({error:error.message}));
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body={},status=200)=>{const response=await fetch(base+path,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;};
  const prepare=(value=input(),status=200)=>post('/api/actions/prepare',value,status);
  const execute=id=>post(`/api/actions/${id}/execute`);
  const decide=(id,decision)=>post(`/api/actions/${id}/decide`,{decision});
  report.stage='negative-http-boundary';
  await prepare({...input(),mode:'discuss'},403);
  await prepare({...input(),documentId:randomUUID()},404);
  const declined=await prepare();await decide(declined.id,'decline');
  assert.equal((await execute(declined.id)).state,'declined');
  const pending=await prepare();await post(`/api/actions/${pending.id}/execute`,{},403);
  gate=new ActionGate({path:join(root,'actions.json'),resolveTarget,adapters});await gate.init();
  assert.equal((await execute(pending.id)).state,'expired');
  const stale=await prepare();await decide(stale.id,'once');
  project=await projects.setRequirement(project.manifest.id,project.manifest.revision,project.hash,
    {name:'Disposable scope change',text:'Invalidate the prior preview without editing CAD',dependsOn:[]});
  const rejected=await execute(stale.id);assert.equal(rejected.state,'failed');assert.match(rejected.detail,/manifest changed/);
  const recurring=await prepare();const allowed=await decide(recurring.id,'always');
  const covered=await prepare();assert.equal(covered.state,'approved');assert.equal(covered.grantId,allowed.grantId);
  const expanded=await prepare(fixtureInput(q,target,[]));assert.equal(expanded.state,'awaiting-approval');
  await decide(expanded.id,'decline');
  await post(`/api/action-grants/${allowed.grantId}/revoke`);
  assert.equal((await execute(recurring.id)).state,'cancelled');assert.equal((await execute(covered.id)).state,'cancelled');
  assert.equal(f.calls(),0);report.zeroDispatchNegativeChecks=true;
  assert.equal((await f.adapter.snapshot(await resolveTarget(input()),input())).snapshot.revision,before.revision);
  report.stage='approved-native-http-update';
  const approved=await prepare();await decide(approved.id,'once');
  report.update=await execute(approved.id);assert.equal(report.update.state,'verified');assert.equal(f.calls(),1);
  assert.deepEqual(await execute(approved.id),report.update);assert.equal(f.calls(),1);
  report.firstKonnectPid=f.pid;await f.close();
  f=await openNativeModelFixture(q);assert.notEqual(f.pid,report.firstKonnectPid);adapters.set('native-models',f.adapter);
  report.stage='fresh-approved-http-restoration';
  const restored=await prepare(fixtureInput(q,target,[]));assert.equal(restored.state,'awaiting-approval');
  await decide(restored.id,'once');report.restoration=await execute(restored.id);
  assert.equal(report.restoration.state,'verified');assert.equal(f.calls(),1);
  report.after=(await f.adapter.snapshot(await resolveTarget(input()),input())).snapshot;
  assert.deepEqual(report.after.before,before.before);assert.notEqual(report.after.revision,before.revision);
  assert.equal(sha(await readFile(q.board)),q.savedSha256);assert.equal(gate.list(target.projectId).grants.length,0);
  const reopened=new ProjectStore({storageRoot:join(root,'projects'),managedRoot:join(root,'managed')});await reopened.init();
  const rebound=await projectTargetResolver(reopened)(input());assert.deepEqual(rebound,report.restoration.target);
  report.projectTarget=rebound;report.totalApplyCalls=2;report.passed=true;report.stage='restored';
  report.limitations=['Real ProjectStore, resolver, HTTP action routes and private MCP native adapter; test-only server, not production registration',
    'Scripted test-operator decisions; no browser, provider or human approval acceptance',
    'Selected model lists and saved file verified; no full unsaved serialization proof'];
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await f.close();if(server)await new Promise(resolve=>server.close(resolve));
  await writeFile(join(root,'receipt.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({passed:report.passed,stage:report.stage,error:report.error,receipt:join(root,'receipt.json')}));}
