import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProductBriefStore} from '../server/product-briefs.mjs';
import {emptyBrief,proposePlan,briefProblems} from '../shared/product-brief.mjs';

const valid=()=>({...emptyBrief(),name:'Desk controller',description:'Control a device and show its status.',disciplines:['electronics','firmware','mechanical']});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'benchline-brief-'));const path=join(root,'product-briefs.json');const store=new ProductBriefStore(path);await store.init();return {root,path,store};}
test('incomplete draft persists and resumes without granting approval',async()=>{
  const {path,store}=await fixture();const r=await store.create(emptyBrief());
  assert.equal(r.revision,1);assert.equal(r.approvedRevision,null);assert.equal(r.plan.executionEnabled,false);
  await assert.rejects(store.approve(r.id,1),/working name/);
  const resumed=new ProductBriefStore(path);await resumed.init();assert.deepEqual(resumed.list(),store.list());
});
test('approval is plan-only; changed requirements retain history and invalidate approval',async()=>{
  const {path,store}=await fixture();const draft=await store.create(valid());const approved=await store.approve(draft.id,1);
  assert.equal(approved.approvedRevision,1);assert.ok(approved.plan.decisions.length>0);assert.equal(approved.plan.executionEnabled,false);
  const changed=await store.update(draft.id,1,{...valid(),power:'USB 5 V'});
  assert.equal(changed.revision,2);assert.equal(changed.approvedRevision,null);assert.equal(changed.approvedAt,null);
  assert.deepEqual(changed.history[0].brief,valid());assert.ok(changed.history[0].approvedAt);
  assert.deepEqual(changed.history[0].plan,approved.plan);
  await assert.rejects(store.approve(draft.id,1),e=>e.status===409);
  const resumed=new ProductBriefStore(path);await resumed.init();assert.equal(resumed.list()[0].revision,2);
  assert.equal((await resumed.approve(draft.id,2)).approvedRevision,2);
});
test('concurrent edits reject stale revision rather than overwrite it',async()=>{
  const {store}=await fixture();const r=await store.create(valid());
  const results=await Promise.allSettled([store.update(r.id,1,{...valid(),power:'USB'}),store.update(r.id,1,{...valid(),power:'Battery'})]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].reason.status,409);
  assert.equal(store.list()[0].brief.power,'USB');
});
test('failed write preserves committed disk and memory; queue recovers',async()=>{
  const {path,store}=await fixture();const r=await store.create(valid());const before=await readFile(path,'utf8');
  store.write=async()=>{throw new Error('disk unavailable');};
  await assert.rejects(store.update(r.id,1,{...valid(),power:'USB'}),/disk unavailable/);
  assert.equal(await readFile(path,'utf8'),before);assert.equal(store.list()[0].revision,1);
  store.write=writeFile;assert.equal((await store.update(r.id,1,{...valid(),power:'USB'})).revision,2);
});
test('corrupt persistence fails closed and is not overwritten',async()=>{
  const {path}=await fixture();await writeFile(path,'invalid document');
  const broken=new ProductBriefStore(path);await assert.rejects(broken.init(),/original file preserved/);
  assert.equal(await readFile(path,'utf8'),'invalid document');
});
test('saved plans are snapshots, not regenerated on reload',async()=>{
  const {path,store}=await fixture();await store.create(valid());const disk=JSON.parse(await readFile(path,'utf8'));
  disk.records[0].plan.tasks[0].title='Original reviewed task';await writeFile(path,JSON.stringify(disk));
  const resumed=new ProductBriefStore(path);await resumed.init();assert.equal(resumed.list()[0].plan.tasks[0].title,'Original reviewed task');
});
test('workspace stores remain separate and callers cannot mutate returned values',async()=>{
  const a=await fixture(),b=await fixture();const created=await a.store.create(valid());created.brief.name='Changed outside';
  assert.equal(a.store.list()[0].brief.name,'Desk controller');assert.deepEqual(b.store.list(),[]);
  await assert.rejects(b.store.approve(created.id,1),e=>e.status===404);
});
test('unchanged save retains approval and does not manufacture a revision',async()=>{
  const {store}=await fixture();const r=await store.create(valid());await store.approve(r.id,1);
  const saved=await store.update(r.id,1,valid());assert.equal(saved.revision,1);assert.equal(saved.approvedRevision,1);assert.deepEqual(saved.history,[]);
});
test('plans select only relevant disciplines and never guess missing requirements',()=>{
  const input={...emptyBrief(),name:'Portal',description:'An app',disciplines:['application']};const plan=proposePlan(input);
  assert.deepEqual(plan.tasks.map(t=>t.id),['definition','application','integration','handoff']);
  assert.equal(plan.decisions.some(d=>d.field==='power'||d.field==='dimensions'),false);
  assert.equal(plan.generator,'local-rules');assert.equal(plan.executionEnabled,false);assert.equal(input.power,'');
  assert.ok(briefProblems({...input,name:'   '}).length);
});
test('every discipline combination yields a valid dependency-ordered plan',()=>{
  const areas=['electronics','firmware','mechanical','application'];
  for(let mask=0;mask<16;mask++){
    const plan=proposePlan({...valid(),disciplines:areas.filter((_,i)=>mask&(1<<i))});const seen=new Set();
    for(const task of plan.tasks){assert.ok(task.dependsOn.every(id=>seen.has(id)));assert.ok(!seen.has(task.id));seen.add(task.id);}
  }
});
test('explicitly undecided responses remain open decisions',()=>{
  const plan=proposePlan({...valid(),power:'Battery, voltage TBD',budget:'not yet decided'});
  assert.ok(plan.decisions.some(d=>d.field==='power'));assert.ok(plan.decisions.some(d=>d.field==='budget'));
});
