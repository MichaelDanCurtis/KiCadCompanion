import test from 'node:test';
import assert from 'node:assert/strict';
import {availableTextModels, assertModelThread, openCandidateModelTransport} from '../server/provider-model.mjs';

const model = 'fixture-model', cwd = '/isolated/empty-workspace';
const row = (change = {}) => ({model, hidden: false, isDefault: true, inputModalities: ['text'], ...change});
const thread = (change = {}) => ({model, modelProvider: 'openai', cwd, approvalPolicy: 'never',
  sandbox: {type: 'readOnly', networkAccess: false}, instructionSources: [], runtimeWorkspaceRoots: [],
  thread: {id: 'thread-fixture', ephemeral: true, modelProvider: 'openai'}, ...change});
const start = () => ({ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: 'Host instructions',
  dynamicTools: ['benchline_prepare_action', 'benchline_action_status', 'benchline_execute_action'].map(name => ({type: 'function', name}))});
function fixture({signedIn = true, response = thread()} = {}) {
  const calls = []; let closes = 0;
  const rpc = {onEvent: () => {}, close: async () => {closes++;}, request: async (method, params) => {
    calls.push({method, params});
    if (method === 'account/read') return {requiresOpenaiAuth: true, account: signedIn ? {type: 'chatgpt'} : null};
    if (method === 'model/list') return {data: [row()], nextCursor: null};
    if (method === 'thread/start') return response;
    return {turn: {id: 'turn-fixture'}};
  }};
  const open = options => openCandidateModelTransport({binary: '/fixture', root: '/fixture', model, openProfile: async () => ({rpc, cwd}), ...options});
  return {rpc, calls, open, closes: () => closes};
}
test('candidate model transport requires its own managed account before model discovery or thread creation', async () => {
  const f = fixture({signedIn: false}); await assert.rejects(f.open(), /Sign in explicitly/);
  assert.deepEqual(f.calls.map(c => c.method), ['account/read']); assert.equal(f.closes(), 1);
});
test('catalogue pagination is bounded and rejects duplicate/cyclic or hidden/non-text selections', async () => {
  const calls = [];
  const result = await availableTextModels({request: async (method, input) => {
    calls.push(input); return calls.length === 1 ? {data: [row({hidden: true})], nextCursor: 'next'} :
      {data: [row({model: 'visible'})], nextCursor: null};
  }});
  assert.deepEqual(result, [{model: 'visible', isDefault: true}]); assert.equal(calls[1].cursor, 'next');
  for (const data of [[row(), row()], [row({hidden: null})], Array(101).fill(row())]) {
    await assert.rejects(availableTextModels({request: async () => ({data})}));
  }
  await assert.rejects(availableTextModels({request: async () => ({data: [], nextCursor: 'loop'})}));
  assert.deepEqual(await availableTextModels({request: async () => ({data: [row({inputModalities: ['image']})]})}), []);
  const f = fixture(); await assert.rejects(f.open({model: 'not-available'}), /no fallback/); assert.equal(f.closes(), 1);
});
test('candidate pins exact model and isolated thread parameters, then limits requests to its own thread', async () => {
  const f = fixture(), rpc = await f.open(); await rpc.request('thread/start', start());
  const params = f.calls.at(-1).params;
  assert.equal(params.model, model); assert.equal(params.cwd, cwd); assert.equal(params.modelProvider, 'openai');
  assert.equal(params.allowProviderModelFallback, false); assert.deepEqual(params.environments, []);
  assert.deepEqual(params.runtimeWorkspaceRoots, []); assert.deepEqual(params.selectedCapabilityRoots, []);
  await rpc.request('turn/start', {threadId: 'thread-fixture', input: [{type: 'text', text: 'Synthetic request'}]});
  const count = f.calls.length;
  await assert.rejects(rpc.request('turn/start', {threadId: 'foreign', input: [{type: 'text', text: 'No'}]}));
  assert.equal(f.calls.length, count); assert.equal(f.closes(), 1);
});
test('thread response rejects model fallback, policy drift, instruction inheritance and extra roots', async () => {
  for (const change of [{model: 'fallback'}, {modelProvider: 'custom'}, {cwd: '/customer'}, {approvalPolicy: 'on-request'},
    {sandbox: {type: 'workspaceWrite'}}, {sandbox: {type: 'readOnly', networkAccess: true}},
    {instructionSources: ['/global/AGENTS.md']}, {runtimeWorkspaceRoots: ['/customer']},
    {thread: {id: 'reused', ephemeral: false, modelProvider: 'openai'}}]) {
    assert.throws(() => assertModelThread(thread(change), {model, cwd}));
    const f = fixture({response: thread(change)}), rpc = await f.open();
    await assert.rejects(rpc.request('thread/start', start())); assert.equal(f.closes(), 1);
  }
});
test('thread/turn options cannot introduce config, paths, external tools or account mutations', async () => {
  for (const change of [{cwd: '/customer'}, {model: 'fallback'}, {config: {shell_tool: true}}, {permissions: 'full-access'},
    {dynamicTools: [{type: 'function', name: 'shell'}, ...start().dynamicTools.slice(1)]}]) {
    const f = fixture(), rpc = await f.open(); const count = f.calls.length;
    await assert.rejects(rpc.request('thread/start', {...start(), ...change})); assert.equal(f.calls.length, count);
  }
  for (const method of ['account/login/start', 'account/logout', 'model/list', 'config/read', 'thread/resume', 'process/spawn']) {
    const f = fixture(), rpc = await f.open(); await assert.rejects(rpc.request(method, {})); assert.equal(f.closes(), 1);
  }
});
test('account changes invalidate candidate transport; aborted setup never returns authority', async () => {
  const f = fixture(), rpc = await f.open(); rpc.onEvent({method: 'account/updated', params: {secret: 'never-forward'}});
  assert.equal(f.closes(), 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.open({signal: abort.signal}), e => e.name === 'AbortError');
});
