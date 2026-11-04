import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import express from 'express';
import {ProjectStore} from '../server/projects.mjs';
import {WorkspaceViews,workspaceViewRoutes} from '../server/workspace-views.mjs';

async function fixture(quiesce=async()=>{}) {
  const root=await mkdtemp(join(tmpdir(),'benchline-workspace-views-'));
  const store=new ProjectStore({storageRoot:join(root,'state'),managedRoot:join(root,'projects')});
  await mkdir(root,{recursive:true});await store.init();
  let project=await store.create({name:'View fixture'});
  project=await store.addArtifact(project.manifest.id,project.manifest.revision,project.hash,
    {name:'Notes',kind:'firmware',path:'notes.txt',dependsOn:[]});
  const input={projectId:project.manifest.id,expectedManifestHash:project.hash,expectedEpoch:project.local.epoch};
  const views=new WorkspaceViews({projects:store,quiesce});
  return {views,store,project,input};
}

test('concurrent joins have one controller; observers cannot recover its token or mutate',async()=>{
  const f=await fixture();
  const joined=await Promise.all([f.views.join(f.input),f.views.join(f.input)]);
  const controller=joined.find(v=>v.role==='controller'),observer=joined.find(v=>v.role==='observer');
  assert.ok(controller && observer);assert.equal(controller.viewId,observer.viewId);
  assert.equal('controllerToken' in observer,false);
  assert.throws(()=>f.views.authorize(f.input.projectId,undefined),{status:403});
  assert.throws(()=>f.views.authorize(f.input.projectId,randomUUID()),{status:403});
  assert.equal(f.views.authorize(f.input.projectId,controller.controllerToken).viewId,controller.viewId);
  assert.equal((await f.views.join(f.input,controller.controllerToken)).role,'controller');
  assert.equal('controllerToken' in await f.views.read(observer.viewId),false);
});
test('a private pre-join nonce recovers a lost first response but is never exposed to observers',async()=>{
  const f=await fixture(),nonce='a'.repeat(64),other='b'.repeat(64);
  const first=await f.views.join(f.input,undefined,nonce);
  const retry=await f.views.join(f.input,undefined,nonce);assert.equal(retry.role,'controller');assert.equal(retry.controllerToken,first.controllerToken);
  const observer=await f.views.join(f.input,undefined,other);assert.equal(observer.role,'observer');assert.equal('claimNonce' in observer,false);
  const publicView=await f.views.read(observer.viewId);assert.equal('claimNonce' in publicView,false);assert.equal('controllerToken' in publicView,false);
  assert.throws(()=>f.views.authorize(f.input.projectId,nonce),{status:403});
  const restarted=new WorkspaceViews({projects:f.store,quiesce:async()=>{}});
  assert.throws(()=>restarted.authorize(f.input.projectId,first.controllerToken),{status:403});
  const next=await restarted.join(f.input,undefined,nonce);assert.notEqual(next.controllerToken,first.controllerToken);
});

test('shared selection is revision-bound, project-bound, and never changes the manifest',async()=>{
  const f=await fixture(),c=await f.views.join(f.input),path=join(f.project.root,'benchline.project.json');
  const before=await readFile(path);
  const selected=await f.views.select(c.viewId,{artifactId:f.project.manifest.artifacts[0].id,expectedRevision:c.revision});
  assert.equal((await f.views.read(c.viewId)).selection,selected.selection);
  await assert.rejects(f.views.select(c.viewId,{artifactId:null,expectedRevision:c.revision}),{status:409});
  await assert.rejects(f.views.select(c.viewId,{artifactId:randomUUID(),expectedRevision:selected.revision}),{status:409});
  assert.deepEqual(await readFile(path),before);
  await assert.rejects(f.views.join({...f.input,expectedEpoch:randomUUID()}),{status:409});
});

test('release blocks admission and replacement until owned operations have settled',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const f=await fixture(()=>pending),c=await f.views.join(f.input);
  const releasing=f.views.release(c.viewId,c.controllerToken);
  assert.throws(()=>f.views.authorize(f.input.projectId,c.controllerToken),{status:403});
  assert.equal((await f.views.join(f.input)).role,'observer');
  await assert.rejects(f.views.select(c.viewId,{artifactId:null,expectedRevision:2}),{status:409});
  finish();assert.equal((await releasing).released,true);
  const next=await f.views.join(f.input);assert.equal(next.role,'controller');
  assert.notEqual(next.controllerToken,c.controllerToken);assert.notEqual(next.viewId,c.viewId);
  await assert.rejects(f.views.read(c.viewId),{status:404});
  assert.throws(()=>f.views.authorize(f.input.projectId,c.controllerToken),{status:403});
});

test('failed cleanup and server restart never restore old controller authority',async()=>{
  const f=await fixture(async()=>{throw Error('Failed cleanup');}),c=await f.views.join(f.input);
  await assert.rejects(f.views.release(c.viewId,c.controllerToken),{status:409});
  assert.equal((await f.views.read(c.viewId)).phase,'blocked');
  assert.throws(()=>f.views.authorize(f.input.projectId,c.controllerToken),{status:403});
  assert.equal((await f.views.join(f.input,c.controllerToken)).role,'observer');
  const restarted=new WorkspaceViews({projects:f.store,quiesce:async()=>{}});
  assert.throws(()=>restarted.authorize(f.input.projectId,c.controllerToken),{status:403});
});

test('HTTP observer writes are denied by an enforced controller boundary',async t=>{
  const f=await fixture(),app=express();app.use(express.json());workspaceViewRoutes(app,f.views);
  let writes=0;
  app.post('/mutate', (req,res)=>{f.views.authorize(req.body.projectId,req.get('X-Benchline-Controller'));writes++;res.json({writes});});
  app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,token)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Benchline-Controller':token}:{})},body:JSON.stringify(body)});
  const controller=await (await post('/api/workspace-views/join',f.input)).json();
  assert.equal((await post('/mutate',{projectId:f.input.projectId})).status,403);assert.equal(writes,0);
  assert.equal((await post('/mutate',{projectId:f.input.projectId},controller.controllerToken)).status,200);assert.equal(writes,1);
  await post(`/api/workspace-views/${controller.viewId}/release`,{},controller.controllerToken);
  assert.equal((await post('/mutate',{projectId:f.input.projectId},controller.controllerToken)).status,403);assert.equal(writes,1);
});
