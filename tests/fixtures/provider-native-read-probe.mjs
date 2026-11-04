// Opt-in real MCP read through the production adapter/gate/callback layer.
// Requires the retained disposable fixture and its explicit test-only socket config.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {unpack} from '../../server/konnect.mjs';
import {config} from '../../server/config.mjs';
import {KonnectAdapter} from '../../server/adapters/konnect.mjs';
import {ActionGate} from '../../server/actions.mjs';
import {createProviderToolSession} from '../../server/provider-tools.mjs';

const fixture=fileURLToPath(new URL('../../.runtime/bl04-native-Gtltml/',import.meta.url));
const path=join(fixture,'benchline-native-test.kicad_pcb');
assert.equal(await realpath(path),path);
const originalConfigPath=join(fixture,'konnect-test.toml');
assert.equal(await realpath(originalConfigPath),originalConfigPath);
const root=await mkdtemp(join(tmpdir(),'benchline-native-read-'));
assert.ok(process.argv.slice(2).every(arg=>['--file-fallback','--bound','--recover'].includes(arg)));
const fallback=process.argv.includes('--file-fallback');
const bound=process.argv.includes('--bound');
const recover=process.argv.includes('--recover');
assert.ok(!recover||bound,'Recovery probe requires explicit live binding');
assert.ok(!(bound&&fallback),'Bound live reads cannot request a successful file fallback');
const expectedIpcAddress=bound?(await readFile(originalConfigPath,'utf8')).match(/^ipc_address\s*=\s*"([^"]+)"$/m)?.[1]:null;
if(bound)assert.ok(expectedIpcAddress);
let configPath=originalConfigPath;
if(fallback){
  const original=await readFile(originalConfigPath,'utf8');
  assert.equal((original.match(/^ipc_address\s*=.*$/gm)||[]).length,1);
  configPath=join(root,'file-only.toml');
  // A private nonexistent socket exercises native file fallback without closing
  // an editor or modifying either the global or retained fixture configuration.
  await writeFile(configPath,original.replace(/^ipc_address\s*=.*$/m,
    `ipc_address = "ipc://${join(root,'no-editor.sock')}"`),{mode:0o600,flag:'wx'});
}
const hash=async()=>createHash('sha256').update(await readFile(path)).digest('hex');
const before=await hash();
const client=new Client({name:'benchline-native-read-conformance',version:'0.1.0'});
const transport=new StdioClientTransport({command:config.konnect,args:['--config',configPath],stderr:'pipe'});
transport.stderr?.on('data',()=>{});
let session,calls=0,bindingCalls=0;
try {
  await client.connect(transport);
  const call=async(name,args={})=>unpack(await client.callTool({name,arguments:args},undefined,{timeout:30000}));
  await call('list_toolboxes');await call('load_user_config');await call('load_toolset',{name:'pcb_board'});
  const tools=(await client.listTools()).tools;
  const adapter=new KonnectAdapter({expectedIpcAddress,connection:async()=>({tools,call:async(name,args)=>{
    if(name==='open_project'){assert.deepEqual(args,{path});bindingCalls++;return call(name,args);}
    assert.equal(name,'get_board_info');assert.deepEqual(args,{board:path});calls++;return call(name,args);
  }})});
  if(recover){
    const verify=adapter.verify.bind(adapter);let first=true;
    adapter.verify=async(...args)=>{const result=await verify(...args);if(first){first=false;assert.equal(result.verified,true);
      return {verified:false,scope:'TEST ONLY: injected verification failure after a successful read'};}return result;};
  }
  const projectId=randomUUID(),documentId=randomUUID();
  const target={projectId,documentId,path,epoch:randomUUID(),manifestHash:'disposable-read-probe'};
  const gate=new ActionGate({path:join(root,'actions.json'),adapters:new Map([['konnect',adapter]]),resolveTarget:async()=>target});
  await gate.init();
  session=await createProviderToolSession({gate,projectId,documentIds:[documentId],threadId:'probe',mode:'discuss'});
  session.beginTurn('read');let n=0;
  const request=async(tool,args,expectedSuccess=true)=>{
    const r=await session.handle({id:++n,method:'item/tool/call',params:{threadId:'probe',turnId:'read',callId:String(n),tool,arguments:args}});
    assert.equal(r.success,expectedSuccess);return JSON.parse(r.contentItems[0].text);
  };
  const prepared=await request('benchline_prepare_action',{documentId,adapter:'konnect',operation:'board-info',args:{}});
  let result=await request('benchline_execute_action',{actionId:prepared.actionId},!recover),recovery=null,finalActionId=prepared.actionId;
  if(recover){
    assert.equal(result.state,'unknown');assert.equal(result.result.status,'unavailable');
    const review=await gate.reviewRecovery(prepared.actionId);
    const accepted=await gate.reconcile(prepared.actionId,{reviewId:review.recoveryReview.id,
      expectedFingerprint:review.recoveryReview.fingerprint,decision:'accept-current-state',
      note:'Opt-in disposable read test: accept freshly observed metadata; retain original uncertainty.'});
    assert.equal(accepted.state,'unknown');assert.equal(accepted.reconciliation.replayAuthorized,false);
    const callsBeforeReplay=calls;
    assert.equal((await request('benchline_execute_action',{actionId:prepared.actionId},false)).state,'unknown');
    assert.equal(calls,callsBeforeReplay);
    const fresh=await request('benchline_prepare_action',{documentId,adapter:'konnect',operation:'board-info',args:{}});
    finalActionId=fresh.actionId;result=await request('benchline_execute_action',{actionId:finalActionId});
    recovery={faultInjection:'Verification failure after successful native read, not real transport loss',
      originalState:accepted.state,replayAuthorized:false,newReadState:result.state};
  }
  assert.equal(result.state,'verified');assert.equal(result.result.status,'available');
  assert.equal(result.result.data.copperLayerCount,2);assert.equal(result.result.data.paper,'A4');
  assert.equal(result.result.data.provenance.source,fallback?'file':'ipc');
  assert.ok(!JSON.stringify(result).includes(path));
  assert.deepEqual((await request('benchline_action_status',{actionId:finalActionId})).result,result.result);
  await request('benchline_execute_action',{actionId:finalActionId});assert.equal(calls,recover?4:1);
  assert.equal(bindingCalls,recover?14:bound?4:0);
  assert.equal(await hash(),before);
  const receipt={at:new Date().toISOString(),kind:'real-konnect-read-projection',fallback,bound,recovery,bindingCalls,nativeReadCalls:calls,
    savedHashBefore:before,savedHashAfter:await hash(),result:result.result,
    limits:['Disposable fixture only; no native mutations or customer operations',
      'Host-driven callbacks; no authenticated model or browser journey',
      'No live revision, dirty-state, custom paper size or concurrent-edit qualification']};
  await writeFile(join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({receipt:join(root,'receipt.json'),...receipt},null,2));
} finally {await session?.close();await client.close();}
