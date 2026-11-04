import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration} from '../server/config.mjs';
test('standalone defaults never discover boards in ancestor folders',()=>{
  const c=configuration({env:{},root:'/tmp/companion-checkout',home:'/tmp/review-home',platform:'linux'});
  assert.equal(c.workspace,'/tmp/companion-checkout/projects');
  assert.equal(c.boardsDir,c.workspace);assert.equal(c.cli,'kicad-cli');
  assert.equal(c.projectSelected,false);assert.equal(c.port,4318);
  assert.equal(c.runtime,'/tmp/companion-checkout/.runtime/benchline/projects/unconfigured');
  assert.equal(c.kiCadConfigDir,'/tmp/review-home/.config/kicad/10.0');
});
test('explicit workspace, state and tool locations override platform defaults',()=>{
  const c=configuration({root:'/tmp/companion',platform:'darwin',env:{COMPANION_WORKSPACE:'/tmp/project',COMPANION_BOARDS_DIR:'pcb',COMPANION_RUNTIME_DIR:'/tmp/local-state',COMPANION_PORT:'4318',COMPANION_AUTOCONNECT:'0',KICAD_APP:'/opt/cad/KiCad.app',KICAD_CLI:'/opt/tools/render',CODEX_BIN:'/opt/tools/codex',KICAD_3DMODEL_DIR:'/opt/models',KICAD_CONFIG_HOME:'/tmp/cad-settings'}});
  assert.equal(c.boardsDir,'/tmp/project/pcb');assert.notEqual(c.runtime,'/tmp/local-state');assert.equal(c.port,4318);
  assert.ok(c.runtime.startsWith('/tmp/companion/.runtime/benchline/projects/'));assert.equal(c.projectSelected,true);
  assert.equal(c.cli,'/opt/tools/render');assert.equal(c.codex,'/opt/tools/codex');assert.equal(c.autoConnect,false);
  assert.equal(c.modelDir,'/opt/models');assert.equal(c.kiCadConfigDir,'/tmp/cad-settings/10.0');
  assert.equal(c.pcbEditor,'/opt/cad/PCB Editor.app');
});
test('invalid ports and board directories outside the selected workspace fail closed',()=>{
  for(const port of ['0','-1','foo','65536','4317.5'])assert.throws(()=>configuration({env:{COMPANION_PORT:port}}),/COMPANION_PORT/);
  assert.throws(()=>configuration({env:{COMPANION_WORKSPACE:'/tmp/project',COMPANION_BOARDS_DIR:'../other'}}),/must stay within/);
});
test('native action binding requires paired explicit local config and IPC endpoint',()=>{
  assert.equal(configuration({env:{}}).actionIpcAddress,null);
  const pair={BENCHLINE_KONNECT_CONFIG:'/tmp/konnect-bound.toml',BENCHLINE_KICAD_IPC:'ipc:///tmp/benchline.sock'};
  const c=configuration({env:pair});assert.equal(c.actionKonnectConfig,pair.BENCHLINE_KONNECT_CONFIG);
  assert.equal(c.actionIpcAddress,pair.BENCHLINE_KICAD_IPC);
  for(const env of [{BENCHLINE_KONNECT_CONFIG:pair.BENCHLINE_KONNECT_CONFIG},
    {BENCHLINE_KICAD_IPC:pair.BENCHLINE_KICAD_IPC},{...pair,BENCHLINE_KONNECT_CONFIG:'relative.toml'},
    {...pair,BENCHLINE_KICAD_IPC:'tcp://remote:1234'}, {...pair,BENCHLINE_KICAD_IPC:'ipc:///tmp/a\nextra'}]){
    assert.throws(()=>configuration({env}));
  }
});
test('local dispatcher is explicit and requires a selected model without a fallback',()=>{
  assert.equal(configuration({env:{}}).providerRuntime,null);
  const pair={BENCHLINE_PROVIDER_RUNTIME:'local-dispatch-v1',BENCHLINE_PROVIDER_MODEL:'selected-model'};
  const c=configuration({env:pair});assert.equal(c.providerRuntime,'local-dispatch-v1');assert.equal(c.providerModel,'selected-model');
  for(const env of [{BENCHLINE_PROVIDER_RUNTIME:pair.BENCHLINE_PROVIDER_RUNTIME},
    {BENCHLINE_PROVIDER_MODEL:pair.BENCHLINE_PROVIDER_MODEL}, {...pair,BENCHLINE_PROVIDER_RUNTIME:'unqualified'},
    {...pair,BENCHLINE_PROVIDER_MODEL:'model\nextra'}])assert.throws(()=>configuration({env}));
});
test('native model registration is a separate explicit host path',()=>{
  assert.equal(configuration({env:{}}).nativeModelRegistration,null);
  assert.equal(configuration({env:{BENCHLINE_NATIVE_MODEL_REGISTRATION:'/tmp/host-binding.json'}}).nativeModelRegistration,'/tmp/host-binding.json');
  for(const value of ['relative.json','/tmp/a\nextra'])assert.throws(()=>configuration({env:{BENCHLINE_NATIVE_MODEL_REGISTRATION:value}}));
});
