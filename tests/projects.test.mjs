import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectStore,contentHash,resolveArtifact} from '../server/projects.mjs';
import {manifestSchema,impactOf} from '../shared/project.mjs';
import {emptyBrief} from '../shared/product-brief.mjs';

async function fixture(liveProvider){const base=await mkdtemp(join(tmpdir(),'benchline-project-')),settings={storageRoot:join(base,'local'),managedRoot:join(base,'products'),liveProvider};const store=new ProjectStore(settings);await store.init();return {base,settings,store};}
const add=(store,p,artifact)=>store.addArtifact(p.manifest.id,p.manifest.revision,p.hash,artifact);
const req=(store,p,requirement)=>store.setRequirement(p.manifest.id,p.manifest.revision,p.hash,requirement);
test('two agent-free, board-free projects remain isolated across restart',async()=>{
  const {store,settings}=await fixture();let a=await store.create({name:'A'}),b=await store.create({name:'B'});
  a=await req(store,a,{name:'USB connector',text:'USB-C with two mounting tabs',dependsOn:[]});
  const resumed=new ProjectStore(settings);await resumed.init();assert.equal(resumed.list().length,2);
  assert.equal((await resumed.open(a.manifest.id)).manifest.requirements.length,1);assert.equal((await resumed.open(b.manifest.id)).manifest.requirements.length,0);
  assert.equal(a.executionEnabled,false);assert.deepEqual(a.local.grants,[]);
});
test('portable manifest rejects versions, duplicate IDs, dangling references and dependency cycles',async()=>{
  const {store}=await fixture();let p=await store.create({name:'Schema'});p=await req(store,p,{name:'Connector',text:'Four pins',dependsOn:[]});
  const m=p.manifest,r=m.requirements[0];
  for(const invalid of [{...m,schemaVersion:99},{...m,requirements:[r,r]},{...m,requirements:[{...r,dependsOn:[randomUUID()]}]},{...m,requirements:[{...r,dependsOn:[r.id]}]}])assert.equal(manifestSchema.safeParse(invalid).success,false);
});
test('absolute, traversal, encoded, Windows and hidden paths are rejected',async()=>{
  const {store}=await fixture();const p=await store.create({name:'Paths'});
  for(const path of ['/secret','../secret','x/../secret','C:/secret','x\\secret','%2e%2e/secret','x//y','.env','x/.private/key'])await assert.rejects(add(store,p,{name:'Bad',kind:'evidence',path,dependsOn:[]}));
  assert.equal((await store.open(p.manifest.id)).manifest.artifacts.length,0);
});
test('symlink escapes are rejected for present files and absent descendants',async()=>{
  const {store,base}=await fixture();const p=await store.create({name:'Symlinks'});const outside=join(base,'outside');await mkdir(outside);await writeFile(join(outside,'file.txt'),'private fixture');await symlink(outside,join(p.root,'escape'));
  await assert.rejects(resolveArtifact(p.root,'escape/file.txt'),/symlink/);await assert.rejects(resolveArtifact(p.root,'escape/new.txt'),/symlink/);
  await assert.rejects(add(store,p,{name:'Escape',kind:'evidence',path:'escape/file.txt',dependsOn:[]}),/symlink/);
});
test('changed connector flags enclosure, firmware and tests without modifying downstream or unrelated files',async()=>{
  const {store}=await fixture();let p=await store.create({name:'Cross discipline'});
  for(const name of ['connector','enclosure','firmware','test','app'])await writeFile(join(p.root,name+'.txt'),name+' v1');
  p=await add(store,p,{name:'Connector export',kind:'electrical',path:'connector.txt',dependsOn:[]});const connector=p.manifest.artifacts[0].id;
  p=await add(store,p,{name:'Enclosure',kind:'mechanical',path:'enclosure.txt',dependsOn:[connector]});const enclosure=p.manifest.artifacts[1].id;
  p=await add(store,p,{name:'Firmware map',kind:'firmware',path:'firmware.txt',dependsOn:[connector]});const firmware=p.manifest.artifacts[2].id;
  p=await add(store,p,{name:'Acceptance tests',kind:'evidence',path:'test.txt',dependsOn:[enclosure,firmware]});const checks=p.manifest.artifacts[3].id;
  p=await add(store,p,{name:'Unrelated UI',kind:'application',path:'app.txt',dependsOn:[]});const app=p.manifest.artifacts[4].id;
  await writeFile(join(p.root,'connector.txt'),'connector v2 with moved mounting tabs');p=await store.open(p.manifest.id);
  assert.deepEqual(p.impact.changed,[connector]);assert.deepEqual(p.impact.downstream,[enclosure,firmware,checks].sort());assert.ok(p.impact.unaffected.includes(app));
  for(const name of ['enclosure','firmware','test','app'])assert.equal(await readFile(join(p.root,name+'.txt'),'utf8'),name+' v1');
  assert.equal(p.local.observations[connector].saved.hash,contentHash('connector v2 with moved mounting tabs'));
  assert.equal(p.local.history.at(-1).observations[connector].saved.hash,p.local.observations[connector].saved.hash);
  assert.deepEqual(impactOf(p.manifest,[connector]),p.impact);
});
test('live revisions/dirty state remain distinct from saved hashes; stale or wrong identity is unavailable',async()=>{
  let signal=null;const {store}=await fixture(async context=>signal?{...context,...signal}:null);let p=await store.create({name:'Live'});
  await writeFile(join(p.root,'design.txt'),'saved bytes');p=await add(store,p,{name:'Design',kind:'electrical',path:'design.txt',dependsOn:[]});const id=p.manifest.artifacts[0].id,hash=p.local.observations[id].saved.hash;
  assert.equal(p.local.observations[id].live.dirty,null);
  signal={revision:'editor-2',dirty:true,observedAt:new Date().toISOString()};p=await store.open(p.manifest.id);
  assert.equal(p.local.observations[id].saved.hash,hash);assert.equal(p.local.observations[id].live.dirty,true);assert.equal(p.local.observations[id].live.revision,'editor-2');assert.ok(p.impact.changed.includes(id));
  signal={revision:'editor-3',dirty:true,observedAt:new Date().toISOString()};p=await store.open(p.manifest.id);assert.equal(p.local.history.at(-1).observations[id].live.revision,'editor-3');
  signal={revision:'editor-3',dirty:false,observedAt:'2000-01-01T00:00:00.000Z'};p=await store.open(p.manifest.id);assert.equal(p.local.observations[id].live.status,'unavailable');
  signal={projectId:randomUUID(),revision:'other',dirty:false,observedAt:new Date().toISOString()};p=await store.open(p.manifest.id);assert.equal(p.local.observations[id].live.status,'unavailable');
});
test('relocation preserves IDs, invalidates grants/epoch and rechecks new locators',async()=>{
  const {store,base,settings}=await fixture();let p=await store.create({name:'Move'});await writeFile(join(p.root,'part.txt'),'v1');p=await add(store,p,{name:'Part',kind:'electrical',path:'part.txt',dependsOn:[]});
  const ids=p.manifest,epoch=p.local.epoch,statePath=join(settings.storageRoot,p.manifest.id+'.json');
  const seeded=JSON.parse(await readFile(statePath,'utf8'));seeded.grants=[{action:'synthetic-future-grant',root:p.root}];await writeFile(statePath,JSON.stringify(seeded));
  const moved=join(base,'moved-project');await rename(p.root,moved);p=await store.openRoot(moved);
  assert.deepEqual(p.manifest,ids);assert.equal(p.relocated,true);assert.notEqual(p.local.epoch,epoch);assert.deepEqual(p.local.grants,[]);assert.equal(p.local.observations[ids.artifacts[0].id].saved.hash,contentHash('v1'));
  assert.equal((await store.open(p.manifest.id)).relocated,false);
});
test('duplicate project copies and identity replacement are refused',async()=>{
  const {store,base}=await fixture();const p=await store.create({name:'Original'});const copy=join(base,'copy');await mkdir(copy);await writeFile(join(copy,'benchline.project.json'),JSON.stringify(p.manifest));
  await assert.rejects(store.openRoot(copy),/still exists/);
  await writeFile(join(p.root,'benchline.project.json'),JSON.stringify({...p.manifest,id:randomUUID()}));await assert.rejects(store.open(p.manifest.id),/identity changed/);
});
test('metadata edits use revision plus file hash to reject concurrent or manual changes',async()=>{
  const {store}=await fixture();const p=await store.create({name:'Concurrency'});await req(store,p,{name:'First',text:'A',dependsOn:[]});
  await assert.rejects(req(store,p,{name:'Stale',text:'B',dependsOn:[]}),e=>e.status===409);
  const current=await store.open(p.manifest.id);await writeFile(join(p.root,'benchline.project.json'),JSON.stringify({...current.manifest,name:'External rename'}));
  await assert.rejects(req(store,current,{name:'Old hash',text:'C',dependsOn:[]}),e=>e.status===409);
});
test('brief import is explicit, snapshots data, and does not mutate source or copy permissions',async()=>{
  const {store}=await fixture();const brief={id:randomUUID(),revision:3,brief:{...emptyBrief(),name:'Brief product',description:'USB controller'}};const before=structuredClone(brief);
  const p=await store.create({name:brief.brief.name,brief});assert.deepEqual(brief,before);assert.deepEqual(p.manifest.sourceBrief,{id:brief.id,revision:3});
  assert.ok(p.manifest.requirements.some(r=>r.text==='USB controller'));assert.equal(p.manifest.artifacts.length,0);assert.deepEqual(p.local.grants,[]);
});
test('requirement updates propagate impact; missing files remain missing and are never fabricated',async()=>{
  const {store}=await fixture();let p=await store.create({name:'Requirements'});p=await req(store,p,{name:'Connector',text:'Two pins',dependsOn:[]});const r=p.manifest.requirements[0];
  p=await add(store,p,{name:'Planned enclosure',kind:'mechanical',path:'housing.txt',dependsOn:[r.id]});const a=p.manifest.artifacts[0];
  p=await req(store,p,{id:r.id,name:r.name,text:'Four pins',dependsOn:[]});assert.ok(p.impact.downstream.includes(a.id));assert.equal(p.manifest.requirements[0].revision,2);assert.equal(p.local.observations[a.id].saved.status,'missing');
  await assert.rejects(readFile(join(p.root,'housing.txt')),e=>e.code==='ENOENT');
});
test('corrupt manifest and local state fail closed without rewriting source data',async()=>{
  const {store,settings}=await fixture();const p=await store.create({name:'Corrupt'});const path=join(p.root,'benchline.project.json');await writeFile(path,'invalid');await assert.rejects(store.open(p.manifest.id));assert.equal(await readFile(path,'utf8'),'invalid');
  await writeFile(path,JSON.stringify(p.manifest));await writeFile(join(settings.storageRoot,p.manifest.id+'.json'),'broken local state');await assert.rejects(store.open(p.manifest.id));
});
test('multi-node cycles and a symlinked manifest are refused',async()=>{
  const {store,base}=await fixture();let p=await store.create({name:'Graph'});
  p=await req(store,p,{name:'A',text:'First',dependsOn:[]});const a=p.manifest.requirements[0];
  p=await req(store,p,{name:'B',text:'Second',dependsOn:[a.id]});const b=p.manifest.requirements[1];
  await assert.rejects(req(store,p,{id:a.id,name:a.name,text:a.text,dependsOn:[b.id]}));
  const linked=join(base,'linked');await mkdir(linked);await symlink(join(p.root,'benchline.project.json'),join(linked,'benchline.project.json'));
  await assert.rejects(store.openRoot(linked),/symlink/);
});
test('an interrupted local observation is reconciled from a committed manifest on reopen',async()=>{
  const {store,settings}=await fixture();let p=await store.create({name:'Recovery'});p=await req(store,p,{name:'Connector',text:'Two pins',dependsOn:[]});
  const statePath=join(settings.storageRoot,p.manifest.id+'.json'),before=await readFile(statePath,'utf8');
  const r=p.manifest.requirements[0];p=await req(store,p,{id:r.id,name:r.name,text:'Four pins',dependsOn:[]});
  // Simulate a manifest replacement followed by failed local projection persistence.
  await writeFile(statePath,before);const resumed=new ProjectStore(settings);await resumed.init();const recovered=await resumed.open(p.manifest.id);
  assert.equal(recovered.manifest.revision,p.manifest.revision);assert.equal(recovered.local.manifestHash,p.hash);assert.ok(recovered.impact.changed.includes(r.id));assert.deepEqual(recovered.local.grants,[]);
});
