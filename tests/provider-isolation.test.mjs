import test from 'node:test';
import assert from 'node:assert/strict';
import {probeQualification, probeEnvironment, probeConfiguration, assertEffectiveProbeConfig, assertProbeToolInventory, assertProbeBinary, parseProbeFeatures} from '../server/provider-isolation.mjs';

test('isolated child environment excludes provider secrets, inherited config and native connections', () => {
  const env = probeEnvironment('/temporary/probe', {HOME:'/user', PATH:'/bin', USER:'test',
    CODEX_HOME:'/shared', OPENAI_API_KEY:'secret', COMPANION_TOKEN:'secret', KICAD_API_SOCKET:'/native',
    HTTP_PROXY:'http://proxy', NODE_OPTIONS:'--require /untrusted', CODEX_CONFIG:'untrusted'});
  assert.deepEqual(env, {HOME:'/user', PATH:'/bin', USER:'test', CODEX_HOME:'/temporary/probe/codex'});
  assert.throws(() => probeEnvironment('relative'));
});
test('unqualified binaries and changed feature inventories fail closed', () => {
  assert.throws(() => assertProbeBinary('codex-cli 0.153.5', Buffer.from('not the qualified binary')), /changed/);
  assert.throws(() => parseProbeFeatures('shell_tool stable true\nnew_unknown stable true'), /requalification/);
  assert.throws(() => parseProbeFeatures('shell_tool stable true\nshell_tool stable true'), /Duplicate/);
  assert.equal(probeQualification.productionEnabled, false);
});
test('synthetic model endpoint rejects external, credentialed and ambiguous destinations', () => {
  for (const endpoint of ['https://example.com/v1','http://localhost:1234/v1','http://127.0.0.1:1234/v1?secret=x',
    'http://user:password@127.0.0.1:1234/v1','http://127.0.0.1:1234/other']) {
    assert.throws(() => probeConfiguration([], endpoint), /endpoint/);
  }
  assert.throws(() => probeConfiguration(['shell_tool'], 'http://127.0.0.1:1234/v1'), /Unqualified/);
});
test('observed tools require exact mediated schemas and refuse hidden native/namespace additions', () => {
  const definitions=[{name:'benchline_test',type:'function',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
  const tools=[{type:'function',name:'request_user_input',parameters:{}}, {type:'function',name:'benchline_test',parameters:definitions[0].inputSchema}];
  assert.equal(assertProbeToolInventory(tools,definitions).productionEnabled,false);
  for (const unexpected of [{type:'function',name:'exec_command',parameters:{}},{type:'custom',name:'apply_patch'},
    {type:'namespace',name:'browser',tools:[]}]) assert.throws(()=>assertProbeToolInventory([...tools,unexpected],definitions));
  assert.throws(()=>assertProbeToolInventory([...tools,tools[1]],definitions),/collision/);
  assert.throws(()=>assertProbeToolInventory([tools[0]],definitions),/Missing/);
  assert.throws(()=>assertProbeToolInventory([{...tools[1],parameters:{type:'object'}}],definitions),/altered/);
});
test('effective settings reject credential, hook, native MCP and permission drift', () => {
  const endpoint='http://127.0.0.1:1234/v1',names=['shell_tool','skip_host_skill_discovery'];
  const config={model_provider:'benchline_probe',model:'benchline-probe',approval_policy:'never',sandbox_mode:'read-only',web_search:'disabled',
    features:{shell_tool:false,skip_host_skill_discovery:true},mcp_servers:{},plugins:{},marketplaces:{},
    project_doc_max_bytes:0,cli_auth_credentials_store:'file',allow_login_shell:false,history:{persistence:'none'},
    model_providers:{benchline_probe:{base_url:endpoint,requires_openai_auth:false,supports_websockets:false}}};
  assert.equal(assertEffectiveProbeConfig(config,names,endpoint).configurationMatches,true);
  assert.equal(assertEffectiveProbeConfig(config,[...names,'apps_mcp_path_override'],endpoint).configurationMatches,true);
  assert.throws(()=>assertEffectiveProbeConfig(config,[...names,'missing_active_feature'],endpoint),/Unexpected effective feature/);
  for(const patch of [{sandbox_mode:'workspace-write'},{mcp_servers:{unsafe:{}}},{hooks:{}},{notify:['command']},
    {features:{...config.features,shell_tool:true}},{features:{...config.features,new_feature:true}}]) {
    assert.throws(()=>assertEffectiveProbeConfig({...config,...patch},names,endpoint));
  }
  config.model_providers.benchline_probe.env_key='INHERITED_KEY';assert.throws(()=>assertEffectiveProbeConfig(config,names,endpoint),/credentials/);
});
