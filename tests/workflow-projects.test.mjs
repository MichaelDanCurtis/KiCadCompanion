import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectStore,contentHash} from '../server/projects.mjs';
import {createProjectWorkflows} from '../server/workflow-projects.mjs';

test('registered project DAG exercises three observation adapters and preserves its original evidence after file edits',async t=>{
  const root=await mkdtemp(join(tmpdir(),'benchline-project-workflow-'));
  const projects=new ProjectStore({storageRoot:join(root,'models'),managedRoot:join(root,'projects')});await projects.init();
  let project=await projects.create({name:'Disposable observation plan'});
  project=await projects.edit(project.manifest.id,project.manifest.revision,project.hash,m=>{
    m.requirements.push({id:randomUUID(),name:'Recorded requirement',text:'Observe the registered file',dependsOn:[],revision:1,contentHash:contentHash('Observe the registered file')});
    m.artifacts.push({id:randomUUID(),name:'Fixture text',kind:'firmware',path:'fixture.txt',dependsOn:[m.requirements[0].id]});
  });
  await writeFile(join(project.root,'fixture.txt'),'v1');project=await projects.open(project.manifest.id);
  const {store,propose}=createProjectWorkflows({path:join(root,'workflow.sqlite'),projects});
  t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});
  const requestId=randomUUID(),p=await propose(project.manifest.id,project.hash,requestId);
  assert.equal((await propose(project.manifest.id,project.hash,requestId)).id,p.id);assert.equal(store.list(project.manifest.id).length,1);
  assert.equal(new Set(p.tasks.map(t=>t.adapter)).size,3);store.activate(p.id,randomUUID());
  for(const task of p.tasks)await store.run(task.id,{requestId:randomUUID()});
  assert.ok(store.get(p.id).tasks.every(t=>t.state==='completed'&&!t.stale));
  await writeFile(join(project.root,'fixture.txt'),'v2');const changed=await store.refresh(p.id);
  assert.equal(changed.tasks[0].stale,false);assert.ok(changed.tasks.slice(1).every(t=>t.stale&&t.evidence[0].current===false));
});
