import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {authenticatedUiOptions, authenticatedProductApproval} from './fixtures/authenticated-product-approval.mjs';

async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'benchline-auth-ui-unit-')));
  const cwd = join(root, 'workspace'); await mkdir(cwd);
  await writeFile(join(root, 'owner.json'), '{}');
  const calls = []; let closes = 0;
  const rpc = {closed: false, toolSession: null, onEvent: () => {}, async close() {
    if (this.closed) return; this.closed = true; closes++; await this.toolSession?.close();
  }, async request(method, params) {
    calls.push({method, params});
    if (method === 'account/read') return {requiresOpenaiAuth: true, account: {type: 'chatgpt'}};
    if (method === 'model/list') return {data: [{model: 'unit-model', hidden: false, isDefault: true, inputModalities: ['text']}]};
    if (method === 'thread/start') return {model: 'unit-model', modelProvider: 'openai', cwd,
      approvalPolicy: 'never', sandbox: {type: 'readOnly', networkAccess: false},
      instructionSources: [], runtimeWorkspaceRoots: [], thread: {id: 'unit-thread', ephemeral: true, modelProvider: 'openai'}};
    if (method === 'turn/start') return {turn: {id: 'unit-turn'}};
    return {};
  }};
  const f = await authenticatedProductApproval({root, binary: '/unused-unit-binary',
    openProfile: async () => ({rpc, cwd}), ...options});
  t.after(() => f.close());
  return {...f, rpc, calls, closes: () => closes};
}
async function pending(f) {
  for (let i = 0; i < 100; i++) {
    const action = f.gate.list(f.scope.projectId).actions[0];
    if (action && f.evidence().heldApprovalObserved) return action;
    await delay(5);
  }
  throw Error('No held action');
}
function proposal(f, value = 'Authenticated product UI fixture') {
  return f.rpc.toolSession.handle({id: 1, method: 'item/tool/call', params: {
    threadId: 'unit-thread', turnId: 'unit-turn', callId: 'prepare', tool: 'benchline_prepare_action',
    arguments: {documentId: f.target.documentId, adapter: 'fixture', operation: 'set-label', args: {value}},
  }});
}

test('authenticated UI requires every explicit one-turn candidate flag', () => {
  const args = ['--serve-authenticated-fixture', '--account-root', '/profile', '--binary', '/binary',
    '--use-advertised-default', '--run-one-turn', '--code-mode-candidate', '--approval-once'];
  assert.equal(authenticatedUiOptions(args).approvalOnce, true);
  for (let i = 0; i < args.length; i++) assert.throws(() => authenticatedUiOptions(args.filter((_, index) => i !== index)));
  assert.throws(() => authenticatedUiOptions([...args, '--extra']));
});

test('qualification page setup is inert, exact prompt only, one attempt survives reconnect', async t => {
  const f = await fixture(t); assert.equal(f.calls.length, 0);
  const selected = await f.controller.select(f.scope);
  await assert.rejects(f.controller.startTurn(selected.selectionId, 'Unreviewed instructions'));
  assert.equal(f.calls.some(c => c.method === 'turn/start'), false);
  await assert.rejects(f.controller.select(f.scope));
  assert.equal(f.evidence().profileAttempts, 1); assert.equal(f.adapter.calls, 0);
});

for (const decision of ['once', 'decline']) test(`authenticated harness delegates ${decision} to actual host gate`, async t => {
  const f = await fixture(t), selected = await f.controller.select(f.scope);
  await f.controller.startTurn(selected.selectionId, f.prompt);
  const preparing = proposal(f), action = await pending(f);
  assert.equal(f.adapter.calls, 0); assert.deepEqual(f.evidence().decisions, []);
  await assert.rejects(f.gate.decide(action.id, 'always'));
  await f.gate.decide(action.id, decision);
  const prepared = JSON.parse((await preparing).contentItems[0].text);
  assert.equal(prepared.state, decision === 'once' ? 'approved' : 'declined');
  const result = await f.rpc.toolSession.handle({id: 2, method: 'item/tool/call', params: {
    threadId: 'unit-thread', turnId: 'unit-turn', callId: 'execute', tool: 'benchline_execute_action', arguments: {actionId: action.id},
  }});
  assert.equal(result.success, decision === 'once'); assert.equal(f.adapter.calls, decision === 'once' ? 1 : 0);
  const completion = {method: 'turn/completed', params: {threadId: 'unit-thread', turn: {id: 'unit-turn', status: 'completed'}}};
  f.rpc.onEvent(completion); await f.rpc.toolSession.handleEvent(completion);
  await assert.rejects(f.controller.startTurn(selected.selectionId, f.prompt));
  assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 1);
  await f.close();
  assert.equal(f.evidence().turnAttempts, 1); assert.equal(f.evidence().workspaceEmpty, true);
  assert.equal(f.evidence().browserVerified, false); assert.equal(f.evidence().passed, false);
});

test('wrong-label proposal cannot produce approval or dispatch', async t => {
  const f = await fixture(t), selected = await f.controller.select(f.scope);
  await f.controller.startTurn(selected.selectionId, f.prompt);
  assert.equal((await proposal(f, 'not the reviewed label')).success, false);
  assert.equal(f.gate.list(f.scope.projectId).actions.length, 0); assert.equal(f.adapter.calls, 0);
});

test('invalid proposal consumes the one-attempt qualification bound without native dispatch', async t => {
  const f=await fixture(t),selected=await f.controller.select(f.scope);
  await f.controller.startTurn(selected.selectionId,f.prompt);
  assert.equal((await proposal(f,'outside reviewed arguments')).success,false);
  const result=await f.rpc.toolSession.handle({id:2,method:'item/tool/call',params:{
    threadId:'unit-thread',turnId:'unit-turn',callId:'second-proposal',tool:'benchline_prepare_action',
    arguments:{documentId:f.target.documentId,adapter:'fixture',operation:'set-label',args:{value:'Authenticated product UI fixture'}},
  }});
  assert.equal(result.success,false);assert.equal(f.evidence().proposals,1);
  assert.equal(f.gate.list(f.scope.projectId).actions.length,0);assert.equal(f.adapter.calls,0);
});

test('qualification deadline closes active authority and cancels held approval', async t => {
  const f = await fixture(t, {deadlineMs: 100}), selected = await f.controller.select(f.scope);
  await f.controller.startTurn(selected.selectionId, f.prompt);
  const preparing = proposal(f), action = await pending(f);
  assert.equal((await preparing).success, false);
  assert.equal(f.evidence().timedOut, true); assert.equal(f.closes(), 1);
  assert.equal(f.gate.get(action.id).state, 'cancelled'); assert.equal(f.adapter.calls, 0);
});
