import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contentHash} from '../server/projects.mjs';
import {createEditorObservation} from '../server/editor-observation.mjs';

function fixture(){
  const board='/private/tmp/benchline-native-live.synthetic/fixtures/BenchlineNativeTest.kicad_pcb',nativeInstance=randomUUID(),ipc='ipc:///synthetic/observer.sock';
  const pin=path=>({path,sha256:contentHash(path)}),config={version:1,board,nativeInstance,ipc,binary:pin('/synthetic/bin'),config:pin('/synthetic/config'),nativeRuntime:pin('/synthetic/runtime')};
  const state={dirty:false,revision:'a'.repeat(64),instance:nativeInstance,path:board,ipc,opens:0,closes:0,calls:[],drift:false};
  const io={stat:async()=>({isFile:()=>true}),readFile:async path=>Buffer.from(state.drift?'changed':path)};
  const connector=async()=>{state.opens++;return {tools:['open_project','experimental_get_model_context','experimental_capture_board_diagnostic'].map(name=>({name})),close:async()=>{state.closes++;},call:async(name,args)=>{
    state.calls.push(name);
    if(name==='open_project')return {ipc_address:state.ipc,ipc_available:true,kicad_ui_running:true,requested_open:true,requested_path:board,requested_board:board,requested_check_error:null,open_boards_error:null,open_board_count:1,open_boards:[board]};
    if(name==='experimental_get_model_context')return {experimental:true,native_instance:state.instance,board:state.path,source:'ipc',approval_granted:false,revision_verified:false};
    if(name==='experimental_capture_board_diagnostic')return {experimental:true,native_instance:state.instance,revision:state.revision,dirty:state.dirty,source:'ipc',approval_granted:false,inputs:{filename:state.path,capture_version:1,board_content:'Never exported to the UI'}};
    throw Error('Unexpected native tool');
  }};};
  const target={projectId:randomUUID(),artifactId:randomUUID(),path:board};
  const observer=createEditorObservation(config,{connector,io,now:()=>Date.parse('2026-09-10T00:00:00Z')});return {observer,state,target,config,io,connector};
}
test('pinned editor observer reports clean and external dirty revisions without exporting board data or action authority',async()=>{
  const f=fixture();try{const clean=await f.observer.observe(f.target);assert.deepEqual(clean,{...f.target,revision:'a'.repeat(64),dirty:false,observedAt:'2026-09-10T00:00:00.000Z'});
    f.state.dirty=true;f.state.revision='b'.repeat(64);const changed=await f.observer.observe(f.target);assert.equal(changed.dirty,true);assert.equal(changed.revision,'b'.repeat(64));assert.equal('inputs' in changed,false);assert.equal('approved' in changed,false);assert.equal(f.state.opens,1);
    assert.ok(f.state.calls.every(name=>['open_project','experimental_get_model_context','experimental_capture_board_diagnostic'].includes(name)));
  }finally{await f.observer.close();}assert.equal(f.state.closes,1);assert.equal(await f.observer.observe(f.target),null);
});
test('unknown dirty state, wrong native identity, changed host pins and foreign artifacts fail closed',async()=>{
  for(const change of [f=>{f.state.dirty=null;},f=>{f.state.dirty=undefined;},f=>{f.state.instance=randomUUID();},f=>{f.state.path='/foreign/board';},f=>{f.state.ipc='ipc:///foreign/socket';},f=>{f.state.revision='not-a-revision';},f=>{f.state.drift=true;}]){const f=fixture();change(f);try{assert.equal(await f.observer.observe(f.target),null);}finally{await f.observer.close();}}
  const f=fixture();assert.equal(await f.observer.observe({...f.target,path:'/foreign/board'}),null);assert.equal(f.state.opens,0);await f.observer.close();
});
test('unconfigured or non-disposable host cannot connect; shutdown discards an in-flight observation',async()=>{
  const f=fixture();for(const config of [null,{...f.config,board:'/customer/board.kicad_pcb'}]){const o=createEditorObservation(config,{connector:f.connector,io:f.io});assert.equal(o.configured,false);assert.equal(await o.observe(f.target),null);await o.close();}assert.equal(f.state.opens,0);
  let begin,finish;const started=new Promise(r=>{begin=r;});const wait=new Promise(r=>{finish=r;});
  const o=createEditorObservation(f.config,{io:f.io,connector:async()=>{begin();await wait;return f.connector();}});const work=o.observe(f.target);await started;const closed=o.close();finish();assert.equal(await work,null);await closed;assert.equal(f.state.closes,1);await f.observer.close();
});
