import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration} from '../server/config.mjs';
test('standalone defaults never discover boards in ancestor folders',()=>{
  const c=configuration({env:{},root:'/tmp/companion-checkout',home:'/tmp/review-home',platform:'linux'});
  assert.equal(c.workspace,'/tmp/companion-checkout/projects');
  assert.equal(c.boardsDir,c.workspace);assert.equal(c.cli,'kicad-cli');
  assert.equal(c.kiCadConfigDir,'/tmp/review-home/.config/kicad/10.0');
});
test('explicit workspace, state and tool locations override platform defaults',()=>{
  const c=configuration({root:'/tmp/companion',platform:'darwin',env:{COMPANION_WORKSPACE:'/tmp/project',COMPANION_BOARDS_DIR:'pcb',COMPANION_RUNTIME_DIR:'/tmp/local-state',COMPANION_PORT:'4318',COMPANION_AUTOCONNECT:'0',KICAD_APP:'/opt/cad/KiCad.app',KICAD_CLI:'/opt/tools/render',CODEX_BIN:'/opt/tools/codex',KICAD_3DMODEL_DIR:'/opt/models',KICAD_CONFIG_HOME:'/tmp/cad-settings'}});
  assert.equal(c.boardsDir,'/tmp/project/pcb');assert.equal(c.runtime,'/tmp/local-state');assert.equal(c.port,4318);
  assert.equal(c.cli,'/opt/tools/render');assert.equal(c.codex,'/opt/tools/codex');assert.equal(c.autoConnect,false);
  assert.equal(c.modelDir,'/opt/models');assert.equal(c.kiCadConfigDir,'/tmp/cad-settings/10.0');
  assert.equal(c.pcbEditor,'/opt/cad/PCB Editor.app');
});
test('invalid ports and board directories outside the selected workspace fail closed',()=>{
  for(const port of ['0','-1','foo','65536','4317.5'])assert.throws(()=>configuration({env:{COMPANION_PORT:port}}),/COMPANION_PORT/);
  assert.throws(()=>configuration({env:{COMPANION_WORKSPACE:'/tmp/project',COMPANION_BOARDS_DIR:'../other'}}),/must stay within/);
});
