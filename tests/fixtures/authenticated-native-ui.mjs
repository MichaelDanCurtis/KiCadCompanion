// Explicit disposable native qualification, not a production registration.
// One signed-in model turn and one exact native proposal per invocation.
import assert from 'node:assert/strict';
import express from 'express';
import {createServer as createVite} from 'vite';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile,mkdtemp,realpath,lstat} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ProjectStore} from '../../server/projects.mjs';
import {ActionGate} from '../../server/actions.mjs';
import {actionRoutes,projectTargetResolver} from '../../server/action-routes.mjs';
import {productProviderRoutes} from '../../server/provider-controller.mjs';
import {openNativeModelFixture,fixtureInput,fixtureModel,sha} from './native-model-fixture.mjs';
import {assertModelOnlyPreserved} from './native-diagnostic-compare.mjs';
import {boundedModelController} from './bounded-model-controller.mjs';

const [mode,phase,qfile,accountRoot,binary,defaultConsent,priorFile,...extra]=process.argv.slice(2);
assert.equal(mode,'--serve-authenticated-disposable-native');assert.equal(extra.length,0);
assert.ok(['assign','restore'].includes(phase));assert.equal(defaultConsent,'--use-advertised-default');
assert.ok([qfile,accountRoot,binary].every(isAbsolute));
assert.equal(await realpath(accountRoot),accountRoot);
assert.ok((await lstat(join(accountRoot,'owner.json'))).isFile());
await assert.rejects(lstat(join(accountRoot,'account-process.lock')),{code:'ENOENT'});
const q=JSON.parse(await readFile(qfile,'utf8'));assert.equal(q.diagnostic,true);
let prior=null;
if(phase==='restore'){
  assert.ok(priorFile&&isAbsolute(priorFile));prior=JSON.parse(await readFile(priorFile,'utf8'));
  assert.equal(prior.phase,'assign');assert.equal(prior.nativeVerified,true);
  assert.equal(prior.report.turnStatus,'completed');assert.deepEqual(prior.qualification,q);
}else assert.equal(priorFile,undefined);
const root=await mkdtemp(join(tmpdir(),'benchline-authenticated-native-'));
const f=await openNativeModelFixture(q);
const before=await f.diagnostic();assert.deepEqual(await f.diagnostic(),before);
if(prior)assert.deepEqual(before,prior.after,'Native state changed since assignment; do not restore blindly');
else assert.ok(before.inputs.native_models.filter(i=>q.footprints.includes(i.footprint)).every(i=>i.models.length===0));
const projects=new ProjectStore({storageRoot:join(root,'projects'),managedRoot:join(root,'managed')});await projects.init();
const project=await projects.openRoot(dirname(q.board));assert.equal(project.manifest.name,'Native model disposable project binding');
const doc=project.manifest.artifacts.find(a=>a.path==='BenchlineNativeTest.kicad_pcb');assert.ok(doc);
const input=fixtureInput(q,{projectId:project.manifest.id,documentId:doc.id},phase==='assign'?[fixtureModel(q)]:[]);
const {idempotencyKey,...expected}=input;
const gate=new ActionGate({path:join(root,'actions.json'),adapters:new Map([['native-models',f.adapter]]),
  resolveTarget:projectTargetResolver(projects)});await gate.init();
const prompt=`This is one bounded real native test on an isolated disposable board, not a customer design.
Use benchline_prepare_action exactly once with documentId ${doc.id}, adapter native-models,
operation set-placed-models and these exact args: ${JSON.stringify(input.args)}.
This will ${phase==='assign'?'assign known 3D models to two test footprints':'restore the original empty model lists on the same two test footprints'}.
Wait for the separate approval decision in Benchline. Do not self-approve or ask in chat.
Only if approved, call benchline_execute_action once with its actionId.
On decline, cancellation, expiry or uncertainty, stop without retrying or trying another route.
Use no other tools. Do not save, undo, or modify anything else.
Finish with one short sentence distinguishing the approval from verified execution.`;
const bounded=boundedModelController({gate,root:accountRoot,binary,prompt,expected,calls:f.calls});
let after=null,preservation=null,nativeVerified=false,closing,expiry,origin;
const errors=[],requests=[];
const evidence=()=>({phase,qualification:q,root,report:structuredClone(bounded.report),
  productionEnabled:false,dispatches:f.calls(),journal:gate.list(project.manifest.id),before,after,preservation,
  nativeVerified,browserVerified:false,humanAcceptance:false,errors,requests,
  limitations:['No complete authenticated tool inventory or production isolation qualification',
    'Exact exported native content only, not unexported editor state or native crash recovery']});
const app=express(),server=createServer(app);
app.use((req,res,next)=>{
  if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return res.sendStatus(403);
  res.set('Cache-Control','no-store');next();
});
app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{if(req.method==='POST')requests.push(req.path);next();});
app.get('/fixture/project',(req,res)=>res.json({...project,root:undefined,
  fixturePrompt:prompt,fixtureNote:`TEST ONLY: ${phase}. One signed-in model turn, actual project controller and real disposable KiCad adapter. Select Agent and Private native board; send the exact prefilled prompt, then Allow once. No automatic approval, save, undo or retry. Production remains disabled.`}));
app.get('/fixture/evidence',(req,res)=>res.json(evidence()));
app.post('/fixture/browser-error',(req,res)=>{errors.push(String(req.body.message).slice(0,2000));res.json({recorded:true});});
app.get('/api/provider/product/capabilities',(req,res)=>res.json({modes:{
  discuss:{supported:false,reason:'Bounded native Agent test only'},agent:{supported:true}}}));
app.use('/api/actions',(req,res,next)=>{
  if(req.method==='POST'&&(req.path==='/prepare'||req.path.endsWith('/execute')))return res.sendStatus(403);
  next();
});
productProviderRoutes(app,bounded.controller);actionRoutes(app,gate,gate.adapters);
app.post('/fixture/verify',async(req,res)=>{
  assert.deepEqual(req.body,{});assert.equal(bounded.report.turnStatus,'completed');
  assert.equal(bounded.report.timedOut,false);assert.equal(bounded.report.turnAttempts,1);
  assert.equal(bounded.report.acceptedTurns,1);assert.equal(bounded.report.proposals,1);
  assert.equal(bounded.report.heldApprovalObserved,true);assert.deepEqual(bounded.report.decisions,['once']);
  assert.equal(f.calls(),1);const journal=gate.list(project.manifest.id);
  assert.equal(journal.actions.length,1);assert.equal(journal.actions[0].state,'verified');assert.equal(journal.grants.length,0);
  after=await f.diagnostic();preservation=assertModelOnlyPreserved(before,after,q.footprints);
  if(prior){assert.equal(after.inputs.board_content,prior.before.inputs.board_content);
    assert.deepEqual(after.inputs.native_models,prior.before.inputs.native_models);}
  assert.equal(sha(await readFile(q.board)),q.savedSha256);assert.deepEqual(errors,[]);
  assert.equal(requests.filter(p=>p==='/api/provider/product/turn').length,1);
  assert.equal(requests.filter(p=>p==='/api/actions/prepare'||p.endsWith('/execute')).length,0);
  nativeVerified=true;await writeFile(join(root,'verified-evidence.json'),JSON.stringify(evidence(),null,2),{flag:'wx',mode:0o600});
  res.json({nativeVerified:true,phase});
});
const vite=await createVite({root:fileURLToPath(new URL('../../',import.meta.url)),server:{middlewareMode:true,hmr:{server},
  fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.runtime/**']}},appType:'custom'});
app.get('/',async(req,res)=>res.type('html').send(await vite.transformIndexHtml('/',`<!doctype html><html><head><link rel="icon" href="data:,"><title>Benchline authenticated native — TEST ONLY</title><style>:root{color-scheme:dark;--line:#35444c;--muted:#acbdc8;--accent:#c5edac;--panel:#172024}button,input,select,textarea{font:inherit;color:inherit}button:disabled{opacity:.5}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:3px}</style></head><body style="margin:0;background:#131b26;color:#e8edf6"><div id="root"></div>
<div style="padding:24px"><button id="verify">Verify native ${phase}</button><p id="result" role="status">Native verification pending.</p></div>
<script>window.addEventListener('error',e=>fetch('/fixture/browser-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:e.message})}));window.addEventListener('unhandledrejection',e=>fetch('/fixture/browser-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:String(e.reason)})}));document.getElementById('verify').onclick=async()=>{try{const r=await fetch('/fixture/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const v=await r.json();document.getElementById('result').textContent=v.nativeVerified?'Native ${phase} verified; saved board unchanged.':v.error;}catch(e){document.getElementById('result').textContent='Verification failed; inspect evidence, do not retry a native operation.';}};</script>
<script type="module" src="/tests/fixtures/product-approval-ui.jsx"></script></body></html>`)));
app.use(vite.middlewares);app.use((error,req,res,next)=>res.status(error.status||400).json({error:'Qualification request rejected; inspect evidence, do not retry an uncertain operation.'}));
server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({origin,root,phase,productionEnabled:false}));
function close(){return closing||=(async()=>{
  clearTimeout(expiry);try{await bounded.close();}finally{
    await writeFile(join(root,'shutdown-evidence.json'),JSON.stringify(evidence(),null,2),{mode:0o600});
    await f.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await vite.close();
  }
})();}
expiry=setTimeout(()=>close().catch(()=>{process.exitCode=1;}),10*60*1000);
process.once('SIGINT',()=>close().catch(()=>{process.exitCode=1;}));process.once('SIGTERM',()=>close().catch(()=>{process.exitCode=1;}));
