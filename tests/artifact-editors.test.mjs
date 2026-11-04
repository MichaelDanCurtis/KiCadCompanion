import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {once} from 'node:events';
import {ArtifactEditors,artifactEditorRoutes} from '../server/artifact-editors.mjs';

function fixture(overrides={}){
  const projectId=randomUUID(),artifactId=randomUUID(),epoch=randomUUID(),hash='a'.repeat(64),calls=[];
  let authorized=true;
  const project={root:'/synthetic-only',hash,local:{epoch,observations:{[artifactId]:{saved:{status:'saved',hash}}}},manifest:{id:projectId,artifacts:[{id:artifactId,kind:'electrical',path:'fixture.kicad_pcb'}]}};
  const editors=new ArtifactEditors({projects:{open:async()=>structuredClone(project)},authorize:(id,token)=>{if(!authorized||id!==projectId||token!=='private-test-token')throw Object.assign(Error('Controller required'),{status:403});},editor:'/synthetic/PCB Editor.app',platform:'darwin',available:async()=>true,
    observe:async()=>({path:'/synthetic-only/fixture.kicad_pcb',savedHash:hash}),launch:async(...args)=>{calls.push(args);},...overrides});
  const input={requestId:randomUUID(),expectedManifestHash:hash,expectedEpoch:epoch,expectedSavedHash:hash};
  return {editors,project,projectId,artifactId,input,calls,revoke:()=>{authorized=false;},open:(body=input,token='private-test-token')=>editors.open(projectId,artifactId,body,token)};
}
test('manual open resolves a registered target once; repeated request cannot relaunch or retarget',async()=>{
  const f=fixture();const [first,second]=await Promise.all([f.open(),f.open()]);assert.deepEqual(first,second);assert.equal(f.calls.length,1);assert.equal(first.liveVerified,false);assert.equal(first.status,'opening-requested');assert.deepEqual(f.calls[0],['/synthetic/PCB Editor.app','/synthetic-only/fixture.kicad_pcb']);
  assert.throws(()=>f.open({...f.input,expectedSavedHash:'b'.repeat(64)}),/reused/);f.revoke();assert.throws(()=>f.open(),{status:403});
});
test('stale, missing, wrong-kind, unavailable and arbitrary-path requests never launch',async()=>{
  for(const mutate of [f=>{f.project.hash='b'.repeat(64);},f=>{f.project.local.epoch=randomUUID();},f=>{f.project.local.observations[f.artifactId].saved.hash='b'.repeat(64);},f=>{f.project.local.observations[f.artifactId].saved.status='missing';},f=>{f.project.manifest.artifacts[0].kind='firmware';},f=>{f.project.manifest.artifacts[0].path='script.sh';}]){const f=fixture();mutate(f);await assert.rejects(()=>f.open());assert.equal(f.calls.length,0);}
  for(const overrides of [{platform:'linux'},{available:async()=>false},{observe:async()=>({path:'/synthetic-only/fixture.kicad_pcb',savedHash:'b'.repeat(64)})}]){const f=fixture(overrides);await assert.rejects(()=>f.open());assert.equal(f.calls.length,0);}
  const f=fixture();assert.throws(()=>f.open({...f.input,path:'/foreign/file'}));assert.throws(()=>f.open(f.input,'observer'),{status:403});assert.equal(f.calls.length,0);
});
test('control lost during observation fails closed; failed open is retained without automatic replay',async()=>{
  let observed,continueObservation;const waiting=new Promise(r=>{observed=r;});const barrier=new Promise(r=>{continueObservation=r;});
  const f=fixture({observe:async()=>{observed();await barrier;return {path:'/synthetic-only/fixture.kicad_pcb',savedHash:'a'.repeat(64)};}});
  const pending=f.open();await waiting;f.revoke();continueObservation();await assert.rejects(pending,{status:403});assert.equal(f.calls.length,0);
  let attempts=0;const g=fixture({launch:async()=>{attempts++;throw Error('Synthetic opening failure');}});await assert.rejects(()=>g.open(),/Synthetic/);await assert.rejects(()=>g.open(),/Synthetic/);assert.equal(attempts,1);
});
test('HTTP opening requires controller and exact request shape; capabilities do not open a file',async()=>{
  const f=fixture(),app=express();app.use(express.json());artifactEditorRoutes(app,f.editors);app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`,path=`/api/artifact-editors/${f.projectId}/${f.artifactId}/open`;
  try{assert.equal((await(await fetch(origin+'/api/artifact-editors/capabilities')).json()).pcb.supported,true);assert.equal(f.calls.length,0);
    assert.equal((await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.input)})).status,403);assert.equal(f.calls.length,0);
    const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-Benchline-Controller':'private-test-token'},body:JSON.stringify(f.input)});assert.equal(response.status,200);assert.equal((await response.json()).liveVerified,false);assert.equal(f.calls.length,1);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
