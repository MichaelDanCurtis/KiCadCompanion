import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createKonnectModelRegistration,konnectModelRegistrationSchema} from '../server/adapters/konnect-model-registration.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const board='/private/tmp/benchline-native-live.synthetic/fixtures/BenchlineNativeTest.kicad_pcb';
  const files=new Map([['/synthetic/konnect','binary'],['/synthetic/config.toml','config'],
    ['/synthetic/kiface','runtime'],[board,'synthetic metadata only'],['/models/part.step','model']]);
  const q={board,savedSha256:sha(files.get(board)),ipc:'ipc:///private/tmp/benchline-registration.sock',
    nativeInstance:randomUUID(),binary:'/synthetic/konnect',binarySha256:sha('binary'),
    config:'/synthetic/config.toml',model:'/models/part.step',footprints:[randomUUID(),randomUUID()]};
  const configuration={qualification:q,configSha256:sha('config'),nativeRuntime:{path:'/synthetic/kiface',sha256:sha('runtime')},
    modelSha256:sha('model'),modelRoots:['/models']};
  const state={opens:0,closes:0,calls:[],instance:q.nativeInstance,ipc:q.ipc,missingTool:false,modelRealpath:q.model};
  const io={async stat(path){if(!files.has(path))throw Error('Missing synthetic file');return {isFile:()=>true};},
    async readFile(path){if(!files.has(path))throw Error('Missing synthetic file');return Buffer.from(files.get(path));},
    async realpath(path){if(path===q.model)return state.modelRealpath;if(path==='/models')return path;throw Error('Missing synthetic root');}};
  const connect=async()=>{
    state.opens++;
    const tools=['open_project','experimental_get_model_context','experimental_preview_placed_models',
      'experimental_apply_placed_models','experimental_inspect_model_result','unrelated_tool'];
    return {tools:tools.filter(name=>!state.missingTool||name!=='experimental_apply_placed_models').map(name=>({name})),
      close:async()=>{state.closes++;},async call(name,args){state.calls.push(name);
        if(name==='open_project')return {ipc_address:state.ipc,ipc_available:true,kicad_ui_running:true,
          requested_open:true,requested_path:board,requested_board:board,requested_check_error:null,
          open_boards_error:null,open_board_count:1,open_boards:[board]};
        if(name==='experimental_get_model_context')return {experimental:true,native_instance:state.instance,
          board,source:'ipc',approval_granted:false,revision_verified:false};
        throw Error('Unexpected synthetic native call');
      }};
  };
  const args={replacements:[{footprint:q.footprints[0],models:[{filename:q.model,scale:{x:1,y:1,z:1},
    rotation:{x:0,y:0,z:0},offset:{x:0,y:0,z:0},visible:true,opacity:1}]}]};
  return {configuration,q,state,files,io,connect,args,open:()=>createKonnectModelRegistration(configuration,{io,connect})};
}

test('native registration absent, malformed or customer-scoped stays unsupported without connection',async()=>{
  for(const configuration of [undefined,{}, {...fixture().configuration,unexpected:true},
    {...fixture().configuration,qualification:{...fixture().q,board:'/customer/board.kicad_pcb'}}]){
    let calls=0;const r=await createKonnectModelRegistration(configuration,{connect:async()=>{calls++;throw Error('Unexpected');}});
    assert.equal(r.status().supported,false);assert.equal(r.adapter.capabilities()[0].supported,false);
    assert.equal(calls,0);await r.close();
  }
});

test('qualified registration discovers and binds native identity and exposes only model assignment',async()=>{
  const f=fixture(),r=await f.open();
  assert.equal(konnectModelRegistrationSchema.safeParse(f.configuration).success,true);
  assert.equal(r.status().supported,true);
  assert.deepEqual(r.adapter.capabilities(),[{operation:'set-placed-models',version:1,effect:'write',supported:true}]);
  assert.deepEqual(f.state.calls,['open_project','experimental_get_model_context']);
  assert.deepEqual(r.adapter.validate('set-placed-models',f.args),f.args);
  r.adapter.validate('set-placed-models',{replacements:[{footprint:f.q.footprints[0],models:[]}]});
  const k=await r.adapter.bound({path:f.q.board});
  assert.equal(k.tools.some(tool=>tool.name==='unrelated_tool'),false);
  await assert.rejects(k.call('unrelated_tool',{}),/unsupported/);
  await r.close();assert.equal(r.status().supported,false);assert.equal(f.state.closes,1);
  assert.equal(r.adapter.capabilities()[0].supported,false);
});

test('registration checks binary, config, native runtime and saved fixture pins before connecting',async()=>{
  for(const key of ['binary','config','native','board']){
    const f=fixture();f.files.set({binary:f.q.binary,config:f.q.config,native:f.configuration.nativeRuntime.path,board:f.q.board}[key],'drift');
    const r=await f.open();assert.equal(r.status().supported,false);assert.equal(f.state.opens,0);await r.close();
  }
});

test('live wrong IPC, native instance or missing conditional capability refuses registration',async()=>{
  for(const change of ['ipc','instance','missingTool']){
    const f=fixture();if(change==='ipc')f.state.ipc='ipc:///private/tmp/wrong.sock';
    if(change==='instance')f.state.instance=randomUUID();if(change==='missingTool')f.state.missingTool=true;
    const r=await f.open();assert.equal(r.status().supported,false);assert.equal(f.state.closes,1);
    assert.ok(!f.state.calls.includes('experimental_apply_placed_models'));await r.close();
  }
});

test('model roots use canonical containment and do not accept sibling prefix or symlink escape',async()=>{
  for(const destination of ['/models-other/part.step','/outside/part.step']){
    const f=fixture();f.state.modelRealpath=destination;f.files.set(destination,'model');
    const r=await f.open();assert.equal(r.status().supported,false);assert.equal(f.state.opens,0);await r.close();
  }
});

test('qualified adapter rejects expanded footprint, model filename, operation or document scope',async()=>{
  const f=fixture(),r=await f.open();
  const footprint=structuredClone(f.args);footprint.replacements[0].footprint=randomUUID();
  const model=structuredClone(f.args);model.replacements[0].models[0].filename='/models/other.step';
  for(const args of [footprint,model])assert.throws(()=>r.adapter.validate('set-placed-models',args),/unsupported/);
  assert.throws(()=>r.adapter.validate('refresh-footprints',f.args),/Unsupported/);
  await assert.rejects(r.adapter.bound({path:'/customer/board.kicad_pcb'}),/unsupported/);
  assert.ok(!f.state.calls.includes('experimental_apply_placed_models'));await r.close();
});

test('post-registration drift is refused before dispatch and permanently invalidates support',async()=>{
  for(const key of ['binary','config','native','board','model']){
    const f=fixture(),r=await f.open(),k=await r.adapter.bound({path:f.q.board});
    if(key==='model'){f.state.modelRealpath='/outside/part.step';f.files.set('/outside/part.step','model');}
    else f.files.set({binary:f.q.binary,config:f.q.config,native:f.configuration.nativeRuntime.path,board:f.q.board}[key],'changed');
    await assert.rejects(k.call('experimental_apply_placed_models',{}),/unsupported/);
    assert.equal(r.status().supported,false);assert.equal(r.adapter.capabilities()[0].supported,false);
    assert.ok(!f.state.calls.includes('experimental_apply_placed_models'));await r.close();
  }
});

test('configuration is copied and later caller mutation cannot broaden authority',async()=>{
  const f=fixture(),r=await f.open();f.configuration.qualification.footprints.push(randomUUID());
  const changed=structuredClone(f.args);changed.replacements[0].footprint=f.configuration.qualification.footprints.at(-1);
  assert.throws(()=>r.adapter.validate('set-placed-models',changed),/unsupported/);await r.close();
});

test('fresh native identity failure invalidates an already registered adapter without reconnect fallback',async()=>{
  const f=fixture(),r=await f.open();f.state.instance=randomUUID();
  await assert.rejects(r.adapter.bound({path:f.q.board}),/unsupported/);
  assert.equal(r.status().supported,false);assert.equal(r.adapter.capabilities()[0].supported,false);
  await assert.rejects(r.adapter.bound({path:f.q.board}),/unsupported/);
  assert.equal(f.state.opens,1);assert.ok(!f.state.calls.includes('experimental_apply_placed_models'));await r.close();
});

test('qualified model bytes are pinned before registration and again before native dispatch',async()=>{
  const changed=fixture();changed.files.set(changed.q.model,'different model asset');
  const refused=await changed.open();assert.equal(refused.status().supported,false);
  assert.equal(changed.state.opens,0);await refused.close();
  const f=fixture(),r=await f.open(),k=await r.adapter.bound({path:f.q.board});
  f.files.set(f.q.model,'different model asset');
  await assert.rejects(k.call('experimental_apply_placed_models',{}),/unsupported/);
  assert.equal(r.status().supported,false);assert.equal(r.adapter.capabilities()[0].supported,false);
  assert.ok(!f.state.calls.includes('experimental_apply_placed_models'));await r.close();
});

test('close during asynchronous pin checks cannot return a cached connection or dispatch a call',async()=>{
  for(const operation of ['connection','call']){
    const f=fixture(),r=await f.open(),k=await r.adapter.bound({path:f.q.board});
    const priorCalls=[...f.state.calls],read=f.io.readFile;
    let entered,release;
    const checking=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
    f.io.readFile=async path=>{if(path===f.q.config){entered();await resume;}return read(path);};
    const pending=operation==='connection'?r.adapter.bound({path:f.q.board}):k.call('experimental_apply_placed_models',{});
    const refused=assert.rejects(pending,/unsupported/);
    await checking;await r.close();release();await refused;
    assert.deepEqual(f.state.calls,priorCalls);
    assert.equal(f.state.closes,1);assert.equal(r.status().supported,false);
    assert.equal(r.adapter.capabilities()[0].supported,false);
  }
});
