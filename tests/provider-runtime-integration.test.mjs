// Synthetic protocol integration only: no account, model process, or native CAD.
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import express from 'express';
import {productApprovalFixture} from './fixtures/product-approval.mjs';
import {createProviderRuntime} from '../server/provider-runtime.mjs';
import {ProductProviderController, productProviderRoutes} from '../server/provider-controller.mjs';
import {actionRoutes} from '../server/action-routes.mjs';
import {CodexAgent} from '../server/codex.mjs';

const body = result => JSON.parse(result.contentItems[0].text);
const product = '/api/provider/product';
async function fixture(t) {
  const base = await productApprovalFixture(), requests = [], rpcs = [];
  const model = 'synthetic-selected-model', cwd = join(base.root, 'empty-profile-workspace');
  let sequence = 0, checks = 0;
  const runtime = await createProviderRuntime({enabled: true, binary: '/synthetic/codex', root: base.root, model}, {
    verifyRuntime: async () => {checks++;},
    openHost: async () => {throw Error('Synthetic profile must not launch a host');},
    openProfile: async () => {
      const rpc = new CodexAgent();
      rpc.request = async (method, params) => {
        assert.equal(rpc.closed, false);
        requests.push({method, params});
        if (method === 'account/read') return {requiresOpenaiAuth: true, account: {type: 'chatgpt'}};
        if (method === 'model/list') return {data: [{model, hidden: false, isDefault: true, inputModalities: ['text']}], nextCursor: null};
        if (method === 'thread/start') return {model, modelProvider: 'openai', cwd, approvalPolicy: 'never',
          sandbox: {type: 'readOnly', networkAccess: false}, instructionSources: [], runtimeWorkspaceRoots: [],
          thread: {id: `thread-${++sequence}`, ephemeral: true, modelProvider: 'openai'}};
        if (method === 'turn/start') return {turn: {id: `turn-${++sequence}`}};
        if (method === 'turn/interrupt') return {};
        throw Error('Unexpected synthetic protocol request');
      };
      rpcs.push(rpc); return {rpc, cwd};
    },
  });
  // Use the actual selected-model/RPC wrapper; only executable/profile I/O is
  // replaced. The controller, action gate, fixture adapter and HTTP routes run.
  const controller = new ProductProviderController({gate: base.gate, ...runtime});
  const app = express(); app.use(express.json());
  productProviderRoutes(app, controller); actionRoutes(app, base.gate, base.gate.adapters);
  app.use((error, req, res, next) => res.status(error.status || 400).json({error: 'Synthetic request rejected'}));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await controller.close(); await base.controller.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function http(path, input, expected = 200) {
    const result = await fetch(origin + path, input === undefined ? undefined : {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input),
    });
    assert.equal(result.status, expected, path); return result.json();
  }
  async function start(mode) {
    const selection = await http(`${product}/select`, {...base.scope, mode});
    const turn = await http(`${product}/turn`, {selectionId: selection.selectionId, text: 'Synthetic integration turn'});
    return {...selection, ...turn};
  }
  function callback(tool, args, session = rpcs.at(-1).toolSession) {
    const identity = session.snapshot();
    return session.handle({id: ++sequence, method: 'item/tool/call', params: {
      threadId: identity.threadId, turnId: identity.turnId || 'closed-turn', callId: `call-${sequence}`, tool, arguments: args,
    }});
  }
  const propose = (operation = 'set-label') => callback('benchline_prepare_action', {
    documentId: base.target.documentId, adapter: 'fixture', operation,
    args: operation === 'set-label' ? {value: 'Reviewed synthetic label'} : {},
  });
  async function pendingAction() {
    for (let i = 0; i < 200; i++) {
      const journal = await http(`/api/actions/project/${base.scope.projectId}`);
      const action = journal.actions.at(-1);
      if (action?.state === 'awaiting-approval') return action;
      await delay(5);
    }
    throw Error('Synthetic proposal did not reach awaiting approval');
  }
  return {...base, controller, requests, rpcs, http, start, callback, propose, pendingAction, checks: () => checks};
}

test('configured runtime routes advertise capabilities without opening and Discuss mediates write/read callbacks', {timeout: 5000}, async t => {
  const f = await fixture(t);
  const capabilities = await f.http(`${product}/capabilities`);
  assert.equal(capabilities.modes.discuss.supported, true); assert.equal(capabilities.modes.agent.supported, true);
  assert.deepEqual(f.requests, []); assert.equal(f.rpcs.length, 0); assert.equal(f.checks(), 1);
  const selected = await f.start('discuss');
  assert.equal(f.checks(), 2);
  const thread = f.requests.find(request => request.method === 'thread/start').params;
  assert.equal(thread.model, 'synthetic-selected-model'); assert.equal(thread.allowProviderModelFallback, false);
  assert.equal((await f.propose()).success, false); assert.equal(f.adapter.calls, 0);
  const read = body(await f.propose('read-label'));
  assert.equal(read.state, 'ready');
  const executed = await f.callback('benchline_execute_action', {actionId: read.actionId});
  assert.equal(executed.success, true); assert.equal(body(executed).state, 'verified');
  assert.equal(f.adapter.value, 'initial'); assert.equal(f.adapter.calls, 1);
  assert.equal((await f.http(`/api/actions/project/${f.scope.projectId}`)).grants.length, 0);
  const session = f.rpcs[0].toolSession;
  await f.http(`${product}/disconnect`, {selectionId: selected.selectionId});
  assert.equal(f.rpcs[0].closed, true);
  assert.equal((await f.callback('benchline_execute_action', {actionId: read.actionId}, session)).success, false);
  assert.equal(f.adapter.calls, 1);
});

for (const decision of ['once', 'decline']) {
  test(`runtime Agent waits for HTTP ${decision} and never acquires model approval authority`, {timeout: 5000}, async t => {
    const f = await fixture(t); await f.start('agent');
    let settled = false;
    const proposed = f.propose().then(result => {settled = true; return result;});
    const action = await f.pendingAction();
    assert.equal(settled, false); assert.equal(f.adapter.calls, 0);
    assert.equal((await f.callback('benchline_decide', {actionId: action.id, decision: 'always'})).success, false);
    await f.http(`/api/actions/${action.id}/decide`, {decision});
    assert.equal(body(await proposed).state, decision === 'once' ? 'approved' : 'declined');
    assert.equal(f.adapter.calls, 0);
    const result = await f.callback('benchline_execute_action', {actionId: action.id});
    assert.equal(result.success, decision === 'once');
    assert.equal(body(result).state, decision === 'once' ? 'verified' : 'declined');
    await f.callback('benchline_execute_action', {actionId: action.id});
    assert.equal(f.adapter.calls, decision === 'once' ? 1 : 0);
    assert.equal((await f.http(`/api/actions/project/${f.scope.projectId}`)).grants.length, 0);
  });
}

test('runtime selection and approved execution reject stale target bindings', {timeout: 5000}, async t => {
  const f = await fixture(t);
  await f.http(`${product}/select`, {...f.scope, expectedManifestHash: 'stale'}, 409);
  assert.equal(f.rpcs.length, 0);
  await f.start('agent');
  const proposed = f.propose(), action = await f.pendingAction();
  await f.http(`/api/actions/${action.id}/decide`, {decision: 'once'}); await proposed;
  f.target.manifestHash = 'changed-after-approval';
  assert.equal((await f.callback('benchline_execute_action', {actionId: action.id})).success, false);
  assert.equal(f.adapter.calls, 0); assert.equal(f.adapter.value, 'initial');
});

test('HTTP disconnect cancels a waiting proposal and invalidates retained callbacks', {timeout: 5000}, async t => {
  const f = await fixture(t), selected = await f.start('agent');
  const session = f.rpcs[0].toolSession, proposed = f.propose(), action = await f.pendingAction();
  await f.http(`${product}/disconnect`, {selectionId: selected.selectionId});
  assert.equal((await proposed).success, false); assert.equal(f.rpcs[0].closed, true);
  assert.equal(f.gate.get(action.id).state, 'cancelled');
  await f.http(`/api/actions/${action.id}/decide`, {decision: 'once'}, 409);
  assert.equal((await f.callback('benchline_execute_action', {actionId: action.id}, session)).success, false);
  assert.equal(f.adapter.calls, 0);
});
