import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { configuration } from '../server/config.mjs';
import { assertInstance, claimState, instanceIdentity } from '../server/instance.mjs';
import { launcherEnvironment } from '../scripts/launcher-settings.mjs';
import { migrationPlan } from '../scripts/migration-plan.mjs';

const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('BENCHLINE_')&&!key.startsWith('COMPANION_')));
const checkout=resolve('.');
async function temp(){return realpath(await mkdtemp(join(tmpdir(),'benchline-foundation-')));}

test('two explicit projects get disjoint state and old runtime is never imported',async()=>{
  const root=await temp(); const common={BENCHLINE_STATE_DIR:join(root,'new-state'),COMPANION_RUNTIME_DIR:join(root,'prototype')};
  const a=configuration({root,env:{...common,BENCHLINE_WORKSPACE:join(root,'a')}});
  const b=configuration({root,env:{...common,BENCHLINE_WORKSPACE:join(root,'b')}});
  assert.notEqual(a.runtime,b.runtime);assert.notEqual(a.projectKey,b.projectKey);
  await claimState(a,root);await claimState(b,root);
  await writeFile(join(a.runtime,'session.json'),JSON.stringify({messages:['project A']}));
  assert.deepEqual(await readdir(b.runtime),['instance.json']);
  await assert.rejects(claimState(a,join(root,'other-checkout')),/different app/);
});

test('unowned existing state is rejected without importing or overwriting it',async()=>{
  const root=await temp(),config=configuration({root,env:{}});
  await mkdir(config.runtime,{recursive:true});
  const path=join(config.runtime,'permissions.json'),original='{"prototype":"never import"}';
  await writeFile(path,original);
  await assert.rejects(claimState(config,root),/not empty/);
  assert.equal(await readFile(path,'utf8'),original);
});

test('board subdirectories cannot escape through a symlink',async()=>{
  const root=await temp(),workspace=join(root,'project'),outside=join(root,'outside');
  await mkdir(workspace);await mkdir(outside);await symlink(outside,join(workspace,'boards'));
  assert.throws(()=>configuration({root,env:{BENCHLINE_WORKSPACE:workspace,BENCHLINE_BOARDS_DIR:'boards'}}),/must stay within/);
});

test('native and plugin launch settings pin the checkout project without copying secrets',()=>{
  const config=configuration({root:'/tmp/benchline',env:{BENCHLINE_WORKSPACE:'/tmp/customer',BENCHLINE_PORT:'4444',OPENAI_API_KEY:'do-not-copy'}});
  const env=launcherEnvironment(config);
  assert.equal(env.BENCHLINE_PORT,'4444');assert.equal(env.BENCHLINE_WORKSPACE,config.workspace);
  assert.equal(env.COMPANION_WORKSPACE,'');assert.equal(env.COMPANION_RUNTIME_DIR,'');
  assert.equal(env.OPENAI_API_KEY,undefined);
  const blank=configuration({root:'/tmp/benchline',env:{}});
  assert.equal(configuration({root:'/tmp/benchline',env:launcherEnvironment(blank)}).projectSelected,false);
});

test('launcher refuses wrong product, checkout, workspace, or state at an occupied port',async()=>{
  const root=await temp();
  const config=configuration({root:checkout,env:{BENCHLINE_STATE_DIR:join(root,'state')}});
  const expected=instanceIdentity(config,checkout);
  assert.doesNotThrow(()=>assertInstance(expected,expected));
  for(const field of ['product','instanceRoot','workspace','runtime','projectKey','projectSelected']) {
    assert.throws(()=>assertInstance({...expected,[field]:'wrong'},expected),/different app/);
  }
  const service=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...expected,product:'prototype'}));});
  service.listen(0,'127.0.0.1');await once(service,'listening');
  try {
    const child=spawn(process.execPath,['scripts/launch.mjs','--server-only'],{cwd:checkout,env:{...cleanEnv,BENCHLINE_PORT:String(service.address().port),BENCHLINE_STATE_DIR:join(root,'state')},stdio:['ignore','pipe','pipe']});
    let output='';child.stderr.on('data',b=>output+=b);
    const [code]=await once(child,'exit');assert.notEqual(code,0);assert.match(output,/different app/);
    assert.deepEqual(await readdir(root),[]);
  } finally {await new Promise(resolve=>service.close(resolve));}
});

test('configuration migration is dry-run only and preserves source state byte for byte',async()=>{
  const root=await temp(),sourceRoot=join(root,'prototype'),sourceState=join(sourceRoot,'.runtime'),workspace=join(root,'project');
  await mkdir(sourceState,{recursive:true});await mkdir(workspace);
  const originals={'session.json':'private history','permissions.json':'private grant','server.log':'private log'};
  for(const [name,contents] of Object.entries(originals))await writeFile(join(sourceState,name),contents);
  const report=await migrationPlan({sourceRoot,sourceState,workspace,root:join(root,'benchline')});
  assert.equal(report.mode,'dry-run');assert.equal(report.importPermissions,false);assert.equal(report.importHistory,false);
  assert.match(report.cutover,/deferred/);assert.ok(report.categories.every(c=>c.disposition.includes('do-not-import')));
  for(const [name,contents] of Object.entries(originals))assert.equal(await readFile(join(sourceState,name),'utf8'),contents);
  assert.ok(!JSON.stringify(report).includes('private history'));
  assert.deepEqual((await readdir(root)).sort(),['project','prototype']);
});

test('unconfigured production server stays empty and blocks all agent entry points',async()=>{
  const root=await temp(),probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:checkout,env:{...cleanEnv,BENCHLINE_PORT:String(port),BENCHLINE_STATE_DIR:join(root,'state'),CODEX_BIN:'/does-not-exist',KONNECT_BIN:'/does-not-exist'},stdio:['ignore','pipe','pipe']});
  let output='';child.stderr.on('data',b=>output+=b);
  try {
    const url=`http://127.0.0.1:${port}`;let response;
    for(let i=0;i<100;i++){try{response=await fetch(url+'/api/state');if(response.ok)break}catch{}await new Promise(r=>setTimeout(r,40));}
    assert.ok(response?.ok,output);const state=await response.json();
    assert.equal(state.product,'benchline');assert.equal(state.projectSelected,false);assert.equal(state.board,null);
    for(const key of ['projects','messages','permissions','renders','requests'])assert.deepEqual(state[key],[]);
    for(const endpoint of ['/api/connect','/api/chat','/api/renders/missing/studio']) {
      const r=await fetch(url+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'hello'})});
      assert.equal(r.status,400);assert.match((await r.json()).error,/project|workspace/i);
    }
    assert.equal((await (await fetch(url+'/api/state')).json()).agent.connected,false);
  } finally {child.kill('SIGTERM');await once(child,'exit');}
});
