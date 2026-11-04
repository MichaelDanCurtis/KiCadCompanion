// Explicit isolated UI/native qualification. No provider, credentials or production registration.
import assert from 'node:assert/strict';
import express from 'express';
import {createServer as createVite} from 'vite';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ProjectStore} from '../../server/projects.mjs';
import {ActionGate} from '../../server/actions.mjs';
import {actionRoutes,projectTargetResolver} from '../../server/action-routes.mjs';
import {openNativeModelFixture,fixtureInput,fixtureModel,sha} from './native-model-fixture.mjs';
import {assertModelOnlyPreserved} from './native-diagnostic-compare.mjs';

assert.equal(process.argv[2],'--serve-disposable-native-ui');assert.equal(process.argv.length,4);assert.ok(isAbsolute(process.argv[3]));
const q=JSON.parse(await readFile(process.argv[3],'utf8'));assert.equal(q.diagnostic,true);
const root=await mkdtemp(join(tmpdir(),'benchline-native-ui-'));
let f=await openNativeModelFixture(q),origin,closing=false,totalPrevious=0,restorationStarted=false;
const before=await f.diagnostic();assert.deepEqual(await f.diagnostic(),before);
assert.ok(before.inputs.native_models.filter(i=>q.footprints.includes(i.footprint)).every(i=>i.models.length===0));
const projects=new ProjectStore({storageRoot:join(root,'projects'),managedRoot:join(root,'managed')});await projects.init();
const project=await projects.openRoot(dirname(q.board));
assert.equal(project.manifest.name,'Native model disposable project binding');
const doc=project.manifest.artifacts.find(a=>a.path==='BenchlineNativeTest.kicad_pcb');assert.ok(doc);
const target={projectId:project.manifest.id,documentId:doc.id};
const adapters=new Map([['native-models',f.adapter]]);
const gate=new ActionGate({path:join(root,'actions.json'),adapters,resolveTarget:projectTargetResolver(projects)});await gate.init();
const decisions=[],errors=[];let changed=null,after=null,preservation=null,restored=null;
const app=express(),server=createServer(app);
app.use((req,res,next)=>{if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return res.sendStatus(403);res.set('Cache-Control','no-store');next();});
app.use(express.json({limit:'32kb'}));
app.post('/fixture/browser-error',(req,res)=>{errors.push(String(req.body.message).slice(0,2000));res.json({recorded:true});});
app.post('/fixture/prepare',async(req,res)=>{
  assert.deepEqual(Object.keys(req.body),['phase']);assert.ok(['assign','restore'].includes(req.body.phase));
  if(req.body.phase==='restore'){
    assert.equal(restorationStarted,false);assert.equal(f.calls(),1);
    assert.ok(gate.list(target.projectId).actions.some(a=>a.state==='verified'));
    changed=await f.diagnostic();preservation=assertModelOnlyPreserved(before,changed,q.footprints);
    assert.equal(sha(await readFile(q.board)),q.savedSha256);
    restorationStarted=true;totalPrevious=f.calls();await f.close();f=await openNativeModelFixture(q);adapters.set('native-models',f.adapter);
    assert.deepEqual(await f.diagnostic(),changed);
  }else{assert.equal(restorationStarted,false);assert.equal(f.calls(),0);}
  res.json(await gate.prepare(fixtureInput(q,target,req.body.phase==='assign'?[fixtureModel(q)]:[])));
});
app.use('/api/actions/:id/decide',(req,res,next)=>{decisions.push({id:req.params.id,decision:req.body.decision});next();});
actionRoutes(app,gate,adapters);
const evidence=()=>({testOnly:true,productionEnabled:false,modelUsed:false,root,dispatches:totalPrevious+f.calls(),decisions,errors,
  journal:gate.list(target.projectId),before,changed,after,preservation,restored});
app.get('/fixture/evidence',(req,res)=>res.json(evidence()));
app.post('/fixture/verify',async(req,res)=>{
  assert.equal(restorationStarted,true);assert.equal(totalPrevious+f.calls(),2);after=await f.diagnostic();
  restored=assertModelOnlyPreserved(before,after,q.footprints);
  assert.equal(after.inputs.board_content,before.inputs.board_content);assert.deepEqual(after.inputs.native_models,before.inputs.native_models);
  assert.equal(sha(await readFile(q.board)),q.savedSha256);assert.equal(gate.list(target.projectId).grants.length,0);assert.deepEqual(errors,[]);
  await writeFile(join(root,'ui-evidence.json'),JSON.stringify(evidence(),null,2),{mode:0o600});res.json({passed:true,receipt:join(root,'ui-evidence.json')});
});
const vite=await createVite({root:fileURLToPath(new URL('../../',import.meta.url)),server:{middlewareMode:true,hmr:{server}},appType:'custom'});
app.get('/',async(req,res)=>res.type('html').send(await vite.transformIndexHtml('/',`<!doctype html><html><head><title>Benchline native approval — TEST ONLY</title><link rel="icon" href="data:,"></head>
<body style="margin:24px;background:#131b26;color:#e8edf6;font-family:system-ui"><h1>Benchline native approval — disposable test</h1>
<p>Real private KiCad adapter and project resolver. No model/provider. Production remains disabled. Two test footprints only; no save or automatic undo.</p>
<button id="assign">Preview model assignment</button><button id="restore">Preview restoration</button><button id="verify">Verify restored native state</button><p id="result" role="status">Ready for a preview. Zero native writes.</p><div id="root"></div>
<script>window.addEventListener('error',e=>fetch('/fixture/browser-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:e.message})}));window.addEventListener('unhandledrejection',e=>fetch('/fixture/browser-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:String(e.reason)})}));</script>
<script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {ActionControls} from '/src/action-controls.jsx';import '/src/product-workspace.css';
const project=${JSON.stringify(project.manifest).replaceAll('<','\\u003c')};createRoot(document.getElementById('root')).render(React.createElement(ActionControls,{project}));
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
for(const phase of ['assign','restore'])document.getElementById(phase).onclick=async()=>{try{const r=await post('/fixture/prepare',{phase});document.getElementById('result').textContent='Preview: '+r.state;}catch(e){document.getElementById('result').textContent=e.message;}};
document.getElementById('verify').onclick=async()=>{try{const r=await post('/fixture/verify',{});document.getElementById('result').textContent=r.passed?'Restoration verified; saved CAD unchanged.':'Verification failed';}catch(e){document.getElementById('result').textContent=e.message;}};
</script></body></html>`)));
app.use(vite.middlewares);app.use((error,req,res,next)=>res.status(error.status??400).json({error:error.message}));
server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({origin,root,testOnly:true}));
async function close(){if(closing)return;closing=true;await writeFile(join(root,'shutdown-evidence.json'),JSON.stringify(evidence(),null,2),{mode:0o600});await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));await vite.close();}
process.once('SIGINT',()=>close().catch(e=>{console.error(e);process.exitCode=1;}));process.once('SIGTERM',()=>close().catch(e=>{console.error(e);process.exitCode=1;}));
