// Real, opt-in BL-08 native fixture. Every CAD change and save goes through MCP.
// The operator authorizes this disposable-fixture procedure, not a customer action.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {join, resolve, isAbsolute} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {unpack} from '../../server/konnect.mjs';
import {ActionGate} from '../../server/actions.mjs';
import {KonnectModelsAdapter} from '../../server/adapters/konnect-models.mjs';
import {assertModelOnlyPreserved,orderedNativeModels} from './native-diagnostic-compare.mjs';

assert.equal(process.argv[2],'--run-disposable-models');
assert.equal(process.argv.length,4);assert.ok(isAbsolute(process.argv[3]));
const q=JSON.parse(await readFile(process.argv[3],'utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
assert.ok(q.board.startsWith(resolve('.runtime')+'/bl08-reference-'));
assert.ok(q.board.endsWith('/reference/BenchlinePassiveReference.kicad_pcb'));
assert.match(q.nativeInstance,/^[0-9a-f-]{36}$/);
assert.ok(q.ipc.startsWith('ipc:///private/tmp/benchline-bl08-native-'));
for(const key of ['binary','config','board','nativeRuntime']) {
  assert.ok(isAbsolute(q[key]));assert.equal(sha(await readFile(q[key])),q[`${key}Sha256`],`${key} changed`);
}
assert.equal(new Set(q.footprints.map(f=>f.id)).size,3);
assert.deepEqual(q.footprints.map(f=>f.ref).sort(),['J1','R1','R2']);
for(const f of q.footprints)assert.equal(sha(await readFile(f.model)),f.modelSha256);
const root=await mkdtemp(resolve('.runtime/bl08-models-'));
const report={at:new Date().toISOString(),root,qualification:q,passed:false,calls:[],stage:'connect'};
const client=new Client({name:'benchline-electronics-model-probe',version:'1.0.0'});
const transport=new StdioClientTransport({command:q.binary,args:['--config',q.config],
  env:{PATH:process.env.PATH,KONNECT_ENABLE_EXPERIMENTAL_MODEL_UPDATE:'1'},stderr:'pipe'});
transport.stderr?.on('data',()=>{});
async function checkpoint(){await writeFile(join(root,'receipt.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});}
async function direct(name,args={}) {
  const entry={at:new Date().toISOString(),name,args};report.calls.push(entry);
  try{const raw=await client.callTool({name,arguments:args},undefined,{timeout:30000});
    entry.result=unpack({...raw,isError:false});entry.isError=raw.isError===true;
    if(entry.isError)throw Error(`${name}: ${JSON.stringify(entry.result)}`);return entry.result;
  }catch(error){entry.error=error.message;throw error;}finally{await checkpoint();}
}
const binding={board:q.board,native_instance:q.nativeInstance};
const diagnostic=()=>direct('experimental_capture_board_diagnostic',binding);
const standard=f=>({filename:f.model,scale:{x:1,y:1,z:1},rotation:{x:0,y:0,z:0},offset:{x:0,y:0,z:0},visible:true,opacity:1});
const normal=q.footprints.map(f=>({footprint:f.id,models:[standard(f)]}));
const mixed=q.footprints.map(f=>({footprint:f.id,models:[f.ref==='R1'?{
  ...standard(f),scale:{x:1.1,y:0.9,z:1},rotation:{x:5,y:10,z:15},offset:{x:0.125,y:-0.25,z:0.3}
}:f.ref==='R2'?{...standard(f),visible:false,opacity:0.5}:standard(f)]}));
try{
  await client.connect(transport);report.server=client.getServerVersion();
  await direct('list_toolboxes');await direct('get_active_toolsets');await direct('load_user_config');
  await direct('load_toolset',{name:'experimental_models'});
  const k={tools:(await client.listTools()).tools,call:direct};
  await writeFile(join(root,'schemas.json'),JSON.stringify(k.tools,null,2)+'\n',{flag:'wx',mode:0o600});
  const context=await direct('experimental_get_model_context',{board:q.board});
  assert.equal(context.native_instance,q.nativeInstance);assert.equal(context.board,q.board);
  report.before=await diagnostic();assert.deepEqual(await diagnostic(),report.before);
  assert.deepEqual(report.before.inputs.native_models.map(f=>f.footprint).sort(),q.footprints.map(f=>f.id).sort());
  if(q.expectedBaselineModels) {
    assert.deepEqual(orderedNativeModels(report.before.inputs.native_models),orderedNativeModels(q.expectedBaselineModels));
  } else assert.ok(report.before.inputs.native_models.every(f=>f.models.length===0));
  const adapter=new KonnectModelsAdapter({connection:async()=>k,expectedIpcAddress:q.ipc,nativeInstance:q.nativeInstance,enabled:true});
  const target={projectId:randomUUID(),documentId:randomUUID(),path:q.board,epoch:randomUUID(),manifestHash:q.boardSha256};
  const gate=new ActionGate({path:join(root,'actions.json'),adapters:new Map([['native-models',adapter]]),resolveTarget:async()=>structuredClone(target)});
  await gate.init();
  async function apply(replacements){
    const input={projectId:target.projectId,documentId:target.documentId,adapter:'native-models',operation:'set-placed-models',
      args:{replacements},mode:'agent',idempotencyKey:randomUUID()};
    const prepared=await gate.prepare(input);await gate.decide(prepared.id,'once');
    const result=await gate.execute(prepared.id);assert.equal(result.state,'verified');return result;
  }
  async function history(direction,snapshot){
    return direct('experimental_run_guarded_history',{...binding,direction,expected_revision:snapshot.revision,request_id:randomUUID()});
  }
  report.stage='mixed-model-apply';report.mixedAction=await apply(mixed);
  report.mixed=await diagnostic();report.mixedPreserved=assertModelOnlyPreserved(report.before,report.mixed,q.footprints.map(f=>f.id));
  for(const requested of mixed)assert.deepEqual(report.mixed.inputs.native_models.find(f=>f.footprint===requested.footprint).models,
    requested.models.map(m=>({filename:m.filename,scale:[m.scale.x,m.scale.y,m.scale.z],
      rotation_deg:[m.rotation.x,m.rotation.y,m.rotation.z],offset_mm:[m.offset.x,m.offset.y,m.offset.z],visible:m.visible,opacity:m.opacity})));
  report.stage='undo';report.undo=await history('undo',report.mixed);report.restored=await diagnostic();
  assert.equal(report.restored.inputs.board_content,report.before.inputs.board_content);
  assert.deepEqual(orderedNativeModels(report.restored.inputs.native_models),orderedNativeModels(report.before.inputs.native_models));
  report.undoPreserved=assertModelOnlyPreserved(report.before,report.restored,q.footprints.map(f=>f.id));
  await direct('save_project');assert.equal(sha(await readFile(q.board)),q.boardSha256,'Undo/save must restore exact saved bytes');
  report.stage='stale-preview';
  const operation={...binding,replacements:normal};const preview=await direct('experimental_preview_placed_models',operation);
  report.redo=await history('redo',await diagnostic());report.redone=await diagnostic();
  let staleRejected=false;
  try{await direct('experimental_apply_placed_models',{operation,token:preview.token});}
  catch(error){assert.match(error.message,/stale/i);staleRejected=true;}
  assert.ok(staleRejected,'Old preview must reject after native redo');
  assert.deepEqual(await diagnostic(),report.redone,'Rejected stale request must not change native state');
  report.finalUndo=await history('undo',report.redone);report.emptyAgain=await diagnostic();
  assert.equal(report.emptyAgain.inputs.board_content,report.before.inputs.board_content);
  report.stage='unsupported-field';let unsupportedRejected=false;
  const malformed=structuredClone(operation);malformed.replacements[0].models[0].unsupported_test_field=true;
  try{await direct('experimental_preview_placed_models',malformed);}catch(error){unsupportedRejected=true;report.unsupportedError=error.message;}
  assert.ok(unsupportedRejected);assert.deepEqual(await diagnostic(),report.emptyAgain);
  report.stage='populated-render-input';report.populatedAction=await apply(normal);report.populated=await diagnostic();
  report.populatedPreserved=assertModelOnlyPreserved(report.before,report.populated,q.footprints.map(f=>f.id));
  await direct('save_project');report.populatedBoardSha256=sha(await readFile(q.board));
  assert.equal(gate.list(target.projectId).grants.length,0);
  report.passed=true;report.stage='saved-populated';
  report.limitations=['Scripted approval on a disposable native fixture; not a new product UI qualification',
    'Footprint sides are recorded in pinned fixture input and native diagnostics; connected nets, DNP and partial-failure cases remain',
    'Saving models is not evidence of a populated render; render and reopen verification remain'];
}catch(error){report.error=error.message;process.exitCode=1;}
finally{try{await client.close();report.transportClosed=true;}catch(error){report.closeError=error.message;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await checkpoint();console.log(JSON.stringify({passed:report.passed,stage:report.stage,error:report.error,receipt:join(root,'receipt.json')}));}
