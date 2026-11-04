// Explicit opt-in: normal server + real Konnect + retained disposable board.
// Adds only a Benchline manifest to the fixture, never edits native CAD files.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {manifestSchema} from '../../shared/project.mjs';
import {config} from '../../server/config.mjs';

assert.ok(process.argv.slice(2).every(arg=>['--wrong-binding','--disconnected'].includes(arg)));
const wrong=process.argv.includes('--wrong-binding');
const disconnected=process.argv.includes('--disconnected');
assert.ok(!(wrong&&disconnected));
const repo=fileURLToPath(new URL('../../',import.meta.url));
const fixture=await realpath(join(repo,'.runtime/bl04-native-Gtltml'));
const board=join(fixture,'benchline-native-test.kicad_pcb');
assert.equal(await realpath(board),board);
const hash=async()=>createHash('sha256').update(await readFile(board)).digest('hex');
const before=await hash();
const konnectConfig=join(fixture,'konnect-test.toml');
assert.equal(await realpath(konnectConfig),konnectConfig);
const ipc=(await readFile(konnectConfig,'utf8')).match(/^ipc_address\s*=\s*"([^"]+)"$/m)?.[1];
assert.ok(ipc);
const manifestPath=join(fixture,'benchline.project.json');
try{await writeFile(manifestPath,JSON.stringify(manifestSchema.parse({schemaVersion:1,id:randomUUID(),name:'Native binding disposable fixture',
  revision:1,sourceBrief:null,requirements:[],artifacts:[{id:randomUUID(),name:'Disposable board',kind:'electrical',
    path:'benchline-native-test.kicad_pcb',dependsOn:[]}]}),null,2)+'\n',{flag:'wx',mode:0o600});}
catch(e){if(e.code!=='EEXIST')throw e;}
assert.ok((await lstat(manifestPath)).isFile());assert.equal(await realpath(manifestPath),manifestPath);
const manifestBytes=await readFile(manifestPath,'utf8'),manifest=manifestSchema.parse(JSON.parse(manifestBytes));
assert.equal(manifest.name,'Native binding disposable fixture');assert.equal(manifest.artifacts.length,1);
assert.equal(manifest.artifacts[0].path,'benchline-native-test.kicad_pcb');
assert.equal(manifest.artifacts[0].kind,'electrical');assert.equal(manifest.requirements.length,0);
const root=await mkdtemp(join(tmpdir(),'benchline-native-http-'));
let selectedConfig=konnectConfig,selectedIpc=ipc;
if(disconnected){
  selectedConfig=join(root,'disconnected-konnect.toml');selectedIpc=`ipc://${join(root,'no-editor.sock')}`;
  const original=await readFile(konnectConfig,'utf8');assert.equal((original.match(/^ipc_address\s*=.*$/gm)||[]).length,1);
  await writeFile(selectedConfig,original.replace(/^ipc_address\s*=.*$/m,`ipc_address = "${selectedIpc}"`),{flag:'wx',mode:0o600});
}
const socketProbe=createServer();socketProbe.listen(0,'127.0.0.1');await once(socketProbe,'listening');
const port=socketProbe.address().port;await new Promise(r=>socketProbe.close(r));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('BENCHLINE_')&&!key.startsWith('COMPANION_')));
const child=spawn(process.execPath,['server/index.mjs'],{cwd:repo,env:{...env,
  BENCHLINE_PORT:String(port),BENCHLINE_WORKSPACE:fixture,BENCHLINE_STATE_DIR:join(root,'state'),BENCHLINE_AUTOCONNECT:'0',
  BENCHLINE_KONNECT_CONFIG:selectedConfig,BENCHLINE_KICAD_IPC:wrong?`ipc://${join(root,'wrong-editor.sock')}`:selectedIpc,
  KONNECT_BIN:config.konnect,CODEX_BIN:'/not-used-by-native-probe'},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>{output=(output+b).slice(-16000);});child.stderr.on('data',b=>{output=(output+b).slice(-16000);});
const exited=once(child,'exit');
const base=`http://127.0.0.1:${port}`;
const get=path=>fetch(base+path,{signal:AbortSignal.timeout(3000)});
const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
let receipt;
try{
  let ready=false;
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw Error('Disposable server exited before readiness');
    try{if((await get('/api/state')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(ready,output);
  const initial=await(await get('/api/state')).json();assert.equal(initial.board,null);assert.equal(initial.agent.connected,false);
  const opened=await post('/api/product-projects/open',{root:fixture});assert.equal(opened.status,200);
  const project=await opened.json();assert.equal(project.manifest.id,manifest.id);
  const input={projectId:manifest.id,documentId:manifest.artifacts[0].id,adapter:'konnect',operation:'board-info',args:{},mode:'discuss',idempotencyKey:randomUUID()};
  const response=await post('/api/actions/prepare',input);
  if(wrong||disconnected){
    assert.equal(response.status,400);const error=await response.json();assert.ok(error.error);
    if(wrong)assert.match(error.error,/binding changed/);
    const journal=await(await get(`/api/actions/project/${manifest.id}`)).json();
    assert.equal(journal.actions.length,0);assert.equal(journal.grants.length,0);
    receipt={scenario:wrong?'wrong-configured-editor-refused':'disconnected-editor-refused',prepareHttpStatus:response.status,actionsPersisted:0};
  }else{
    assert.equal(response.status,200);const prepared=await response.json();assert.equal(prepared.state,'ready');
    assert.match(prepared.preview.summary,/explicitly bound live editor/);
    const execution=await post(`/api/actions/${prepared.id}/execute`,{});assert.equal(execution.status,200);
    const action=await execution.json();assert.equal(action.state,'verified');assert.equal(action.receipt.source,'ipc');
    assert.equal(action.receipt.binding.ipcAddress,ipc);assert.equal(action.receipt.binding.documentPath,board);
    const duplicate=await(await post(`/api/actions/${prepared.id}/execute`,{})).json();assert.deepEqual(duplicate,action);
    const journal=await(await get(`/api/actions/project/${manifest.id}`)).json();assert.equal(journal.actions.length,1);assert.equal(journal.grants.length,0);
    assert.equal((await post('/api/actions/prepare',{...input,operation:'refresh-footprints',idempotencyKey:randomUUID()})).status,422);
    // Register a missing file reference in a different, server-managed disposable
    // product. No CAD file is created. It must not read the board in the socket.
    let other=await(await post('/api/product-projects',{name:'Not-open document test'})).json();
    const artifactResponse=await post(`/api/product-projects/${other.manifest.id}/artifacts`,{
      expectedRevision:other.manifest.revision,expectedHash:other.hash,
      artifact:{name:'Not open',kind:'electrical',path:'not-open.kicad_pcb',dependsOn:[]}});
    assert.equal(artifactResponse.status,200);other=await artifactResponse.json();
    const denied=await post('/api/actions/prepare',{...input,projectId:other.manifest.id,
      documentId:other.manifest.artifacts[0].id,idempotencyKey:randomUUID()});
    assert.equal(denied.status,400);
    assert.equal((await(await get(`/api/actions/project/${other.manifest.id}`)).json()).actions.length,0);
    receipt={scenario:'bound-project-http-read',actionId:action.id,state:action.state,source:action.receipt.source,
      actionsPersisted:1,recurringGrants:0,notOpenDocumentRefused:true};
  }
  const final=await(await get('/api/state')).json();assert.equal(final.board,null);assert.equal(final.agent.connected,false);
  assert.equal(await hash(),before);assert.equal(await readFile(manifestPath,'utf8'),manifestBytes);
  receipt={at:new Date().toISOString(),...receipt,savedHashBefore:before,savedHashAfter:await hash(),
    limits:['Read-only disposable fixture; no native edits or customer operations',
      'Normal HTTP routes and configured MCP transport; no browser or authenticated model',
      'No atomic native write or live revision qualification']};
}finally{
  if(child.exitCode===null)child.kill('SIGTERM');
  let timeout;
  try{const [code,signal]=await Promise.race([exited,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Disposable server did not exit; inspect its live process')),10000);})]);
    assert.equal(code,0);assert.equal(signal,null);}finally{clearTimeout(timeout);}
}
await writeFile(join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:join(root,'receipt.json'),...receipt},null,2));
