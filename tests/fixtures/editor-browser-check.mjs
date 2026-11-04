// Actual isolated production UI + pinned disposable KiCad editor. Two explicit,
// reviewed model-list operations through ActionGate/Konnect; no save or auto-retry.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {ActionGate} from '../../server/actions.mjs';
import {openNativeModelFixture,fixtureInput,fixtureModel,sha} from './native-model-fixture.mjs';
import {assertModelOnlyPreserved} from './native-diagnostic-compare.mjs';

const [flag,hostPath,packagePath,executablePath,output]=process.argv.slice(2);
assert.ok(['--run-disposable-local-editor','--run-disposable-editor-stale'].includes(flag));
const staleOnly=flag==='--run-disposable-editor-stale';
if(!staleOnly)assert.equal(process.stdin.isTTY,true);
assert.ok([hostPath,packagePath,executablePath,output].every(p=>p&&resolve(p)===p));
const host=JSON.parse(await readFile(hostPath,'utf8'));
assert.equal(host.board,'/private/tmp/benchline-native-live.5Aj7Ez/fixtures/BenchlineNativeTest.kicad_pcb');
const original=JSON.parse(await readFile('.runtime/native-model-registration-current.json','utf8'));
const q={...original.qualification,nativeInstance:host.nativeInstance,binarySha256:host.binary.sha256};
assert.equal(q.binary,host.binary.path);assert.equal(q.config,host.config.path);assert.equal(sha(await readFile(q.board)),q.savedSha256);
const manifest=JSON.parse(await readFile(join(dirname(q.board),'benchline.project.json'),'utf8'));
const artifact=manifest.artifacts.find(a=>a.path==='BenchlineNativeTest.kicad_pcb');assert.ok(artifact);
const root=await mkdtemp(join(tmpdir(),'benchline-editor-browser-'));await mkdir(output,{recursive:true});await mkdir(join(root,'workspace'));
const portProbe=createServer();portProbe.listen(0,'127.0.0.1');await once(portProbe,'listening');const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('BENCHLINE_')&&!key.startsWith('COMPANION_')));
const child=spawn(process.execPath,['server/index.mjs'],{env:{...clean,BENCHLINE_WORKSPACE:join(root,'workspace'),BENCHLINE_STATE_DIR:join(root,'state'),BENCHLINE_PORT:String(port),BENCHLINE_AUTOCONNECT:'0',CODEX_BIN:'/nonexistent/no-model',KONNECT_BIN:'/nonexistent/no-global-native',BENCHLINE_EDITOR_OBSERVATION:hostPath,KICAD_PCB_EDITOR:resolve('.runtime/kicad-revision-build/pcbnew/BenchlineNativeTest.app')},stdio:['ignore','pipe','pipe']});
const closed=once(child,'close');let serverLog='';child.stdout.on('data',b=>serverLog+=b);child.stderr.on('data',b=>serverLog+=b);
const origin=`http://127.0.0.1:${port}`,evidence={timestamp:new Date().toISOString(),root,origin,host,modelUsed:false,productionModelAssignment:false,checks:[],errors:[],passed:false};
const input=createInterface({input:process.stdin});const lines=[];let nextLine;
input.on('line',line=>{if(nextLine){const fn=nextLine;nextLine=null;fn(line);}else lines.push(line);});
async function waitFor(command){console.log(`WAITING: ${command}`);for(;;){const line=lines.length?lines.shift():await new Promise(r=>{nextLine=r;});if(line===command)return;}}
let browser,page,native;
try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/state')).ok)break;}catch{}if(child.exitCode!==null)throw Error(serverLog);await delay(100);}
  const {chromium}=await import(pathToFileURL(join(packagePath,'index.mjs')));browser=await chromium.launch({headless:true,executablePath});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
  evidence.browser=browser.version();evidence.node=process.version;page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.errors.push(m.text());});
  await page.goto(origin,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Project model',exact:true}).click();
  await page.getByLabel('Existing project folder').fill(dirname(q.board));await page.getByRole('button',{name:'Open folder manifest',exact:true}).click();
  await page.getByRole('status').filter({hasText:'This window controls this project.'}).waitFor();
  await page.getByRole('navigation',{name:'Product disciplines',exact:true}).getByRole('button',{name:'Electronics',exact:true}).click();await page.getByRole('button',{name:`Select ${artifact.name}`,exact:true}).click();
  const context=page.locator('.product-agent').getByRole('region',{name:'Selected artifact context'});
  await context.getByText(/Editor: observed clean/).waitFor();evidence.checks.push('Actual pinned native diagnostic appears as observed clean beside the composer');
  const beforeOpen=(await(await fetch(origin+`/api/product-projects/${manifest.id}`)).json());
  assert.equal((await page.request.post(origin+`/api/artifact-editors/${manifest.id}/${artifact.id}/open`,{data:{requestId:'00000000-0000-4000-8000-000000000001',expectedManifestHash:beforeOpen.hash,expectedEpoch:beforeOpen.local.epoch,expectedSavedHash:q.savedSha256}})).status(),403);
  await page.getByRole('button',{name:'Open selected PCB in KiCad',exact:true}).click();await page.getByText('Opening requested. Confirm the file in KiCad; this does not verify a live editor connection or authorize changes.',{exact:true}).waitFor();
  evidence.checks.push('Real selected-artifact opening request succeeds; controllerless request is denied');
  if(staleOnly){
    let captured,notifyCapture;const capturedReady=new Promise(r=>{notifyCapture=r;});
    const pattern=origin+'/api/workspace-views/**';
    await page.route(pattern,async route=>{if(route.request().method()!=='GET')return route.continue();if(!captured){const response=await route.fetch();captured=await response.json();notifyCapture();return route.fulfill({response,json:captured});}return route.fulfill({json:captured});});
    await capturedReady;
    await page.waitForFunction(at=>Date.now()-Date.parse(at)>=10000,captured.project.local.observations[artifact.id].live.observedAt,{timeout:25000});
    await context.getByText(/Editor: stale — refresh required/).waitFor({timeout:25000});
    assert.equal(captured.project.local.observations[artifact.id].live.status,'observed');
    assert.ok(Date.now()-Date.parse(captured.project.local.observations[artifact.id].live.observedAt)>=10000);
    await context.scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'observed-stale.png')});
    evidence.checks.push('A real native observation ages into visible stale state when its delivery is held; no synthetic revision or clock is used');
    await page.unroute(pattern);await context.getByText(/Editor: observed clean/).waitFor();evidence.checks.push('Fresh native observation delivery restores clean context');
    evidence.mutations=0;
  }else{
  native=await openNativeModelFixture(q);evidence.before=await native.diagnostic();assert.equal(evidence.before.dirty,false);assert.equal(evidence.before.native_instance,host.nativeInstance);
  const target={projectId:manifest.id,documentId:artifact.id,path:q.board,manifestHash:beforeOpen.hash,epoch:beforeOpen.local.epoch};
  const adapters=new Map([['native-models',native.adapter]]),gate=new ActionGate({path:join(root,'external-fixture-actions.json'),adapters,resolveTarget:async()=>structuredClone(target)});await gate.init();
  const initial=(await native.adapter.snapshot(target,fixtureInput(q,target,[fixtureModel(q)]))).snapshot;assert.ok(initial.before.every(i=>i.models.length===0));
  console.log('Applying one reviewed model-list change to the exact disposable board through Konnect.');
  const action=await gate.prepare(fixtureInput(q,target,[fixtureModel(q)]));await gate.decide(action.id,'once');evidence.applied=await gate.execute(action.id);assert.equal(evidence.applied.state,'verified');assert.equal(native.calls(),1);
  evidence.changed=await native.diagnostic();assert.equal(evidence.changed.dirty,true);evidence.preservation=assertModelOnlyPreserved(evidence.before,evidence.changed,q.footprints);assert.equal(sha(await readFile(q.board)),q.savedSha256);
  await context.getByText(/Editor: unsaved changes/).waitFor();await context.getByText('Changed · dependent work needs review',{exact:true}).waitFor();await context.scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'observed-dirty.png')});
  evidence.checks.push('External reviewed native edit updates revision, dirty context and dependent-review warning while saved bytes stay unchanged');
  await writeFile(join(output,'dirty-checkpoint.json'),JSON.stringify({nativeInstance:host.nativeInstance,revision:evidence.changed.revision,dirty:true,savedHash:q.savedSha256},null,2));
  await waitFor('restore-fixture');
  // A separately approved restoration after exact current-state verification.
  await native.close();native=await openNativeModelFixture(q);adapters.set('native-models',native.adapter);assert.deepEqual(await native.diagnostic(),evidence.changed);
  const restore=await gate.prepare(fixtureInput(q,target,[]));await gate.decide(restore.id,'once');evidence.restored=await gate.execute(restore.id);assert.equal(evidence.restored.state,'verified');assert.equal(native.calls(),1);
  evidence.after=await native.diagnostic();assertModelOnlyPreserved(evidence.before,evidence.after,q.footprints);assert.deepEqual(evidence.after.inputs.native_models,evidence.before.inputs.native_models);assert.equal(evidence.after.inputs.board_content,evidence.before.inputs.board_content);assert.equal(sha(await readFile(q.board)),q.savedSha256);
  evidence.checks.push('Separate approved restoration returns all native model and serialized board data to baseline without saving');
  await native.close();native=null;await waitFor('verify-disconnect');
  await context.getByText(/Editor: unavailable \/ disconnected/).waitFor({timeout:30000});await context.scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'observed-disconnected.png')});evidence.checks.push('Closing the actual disposable editor makes context unavailable without claiming clean or replaying work');
  }
  assert.equal(sha(await readFile(q.board)),q.savedSha256);assert.deepEqual(evidence.errors,[]);evidence.passed=true;
}catch(error){evidence.error=error.stack;if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw error;}
finally{input.close();await native?.close();await browser?.close();child.kill('SIGTERM');const [code]=await closed;evidence.serverExitCode=code;await writeFile(join(output,'server.log'),serverLog);await writeFile(join(output,'evidence.json'),JSON.stringify(evidence,null,2));}
