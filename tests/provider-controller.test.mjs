import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ProductProviderController, productProviderRoutes} from '../server/provider-controller.mjs';
import {CodexAgent} from '../server/codex.mjs';
import express from 'express';
import {once} from 'node:events';
const latch = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
test('product capability views are isolated from caller mutation and legacy mode gates', async () => {
  const boundary={version:1,provider:'qualified-test',modes:{discuss:{supported:true},agent:{supported:true}}};
  const c=new ProductProviderController({gate:{},boundary,requireMode:()=>{}});
  boundary.modes.discuss.supported=false;
  const view=c.capabilities();assert.equal(view.modes.discuss.supported,true);
  view.modes.agent.supported=false;assert.equal(c.capabilities().modes.agent.supported,true);
  await assert.rejects(new CodexAgent().connect(),/not verified|qualified|paused|unsupported/);
});
function fixture() {
  const scope = {projectId: randomUUID(), documentIds: [randomUUID()], mode: 'discuss',
    expectedManifestHash: 'manifest-v1', expectedEpoch: randomUUID()};
  const target = {projectId: scope.projectId, documentId: scope.documentIds[0], path: '/disposable/fixture',
    manifestHash: scope.expectedManifestHash, epoch: scope.expectedEpoch};
  const gate = {resolveTarget: async () => structuredClone(target)};
  let hook, opens = 0; const rpcs = [], requests = [];
  const openTransport = async options => {
    opens++; if (hook) await hook(options);
    const rpc = new CodexAgent();
    rpc.request = async (method, params) => {
      requests.push({method, params});
      if (method === 'thread/start') return {thread: {id: `thread-${opens}`}};
      if (method === 'turn/start') return {turn: {id: `turn-${requests.length}`}};
      return {};
    };
    rpcs.push(rpc); return rpc;
  };
  const controller = new ProductProviderController({gate, openTransport, requireMode: () => {}});
  return {controller, gate, scope, target, rpcs, requests, opens: () => opens, hook: value => {hook = value;}, openTransport};
}
test('production product controller refuses unsupported modes before observing or spawning', async () => {
  const f = fixture();
  const controller = new ProductProviderController({gate: {resolveTarget: () => {throw Error('must not observe');}}, openTransport: f.openTransport});
  assert.deepEqual(controller.status(), {selectionId: null, scope: null, phase: 'disconnected'});
  await assert.rejects(controller.select(f.scope), e => e.status === 422);
  assert.equal(f.opens(), 0); assert.equal(controller.status().phase, 'unsupported'); await controller.close();
});
test('selection is bound to host-resolved project revision; arbitrary launch and permission fields fail', async () => {
  const f = fixture();
  for (const change of [{cwd: '/customer'}, {approval: 'always'}, {rpc: 'process/spawn'}, {profile: '/global'}]) {
    await assert.rejects(f.controller.select({...f.scope, ...change}));
  }
  await assert.rejects(f.controller.select({...f.scope, expectedManifestHash: 'stale'}), e => e.status === 409);
  assert.equal(f.opens(), 0);
  const selected = await f.controller.select(f.scope);
  assert.ok(selected.selectionId); assert.equal(selected.phase, 'ready');
  assert.doesNotMatch(JSON.stringify(selected), /disposable|manifest-v1/);
  f.scope.documentIds.push(randomUUID()); assert.equal(f.controller.status().scope.documentIds.length, 1);
  await f.controller.close();
});
test('switching product selection revokes the previous session and rejects old browser controls', async () => {
  const f = fixture(), first = await f.controller.select(f.scope);
  await f.controller.startTurn(first.selectionId, 'A scoped request');
  const second = await f.controller.select({...f.scope, mode: 'agent'});
  assert.equal(f.rpcs[0].closed, true); assert.notEqual(first.selectionId, second.selectionId);
  const count = f.requests.length;
  for (const action of [() => f.controller.startTurn(first.selectionId, 'Stale'),
    () => f.controller.stop(first.selectionId), () => f.controller.disconnect(first.selectionId)]) await assert.rejects(action(), e => e.status === 409);
  assert.equal(f.requests.length, count); assert.equal(f.rpcs[1].closed, false);
  await f.controller.disconnect(second.selectionId); assert.equal(f.rpcs[1].closed, true);
});
test('close during transport opening rejects and closes late transport without creating a thread', async () => {
  const f = fixture(), entered = latch(), release = latch();
  f.hook(async () => {entered.resolve(); await release.promise;});
  const opening = f.controller.select(f.scope); await entered.promise;
  const closing = f.controller.close(); release.resolve();
  await assert.rejects(opening, e => e.status === 409);
  await closing;
  assert.equal(f.rpcs[0].closed, true); assert.equal(f.requests.length, 0);
  assert.equal(f.controller.status().phase, 'disconnected');
});
test('project changes during process launch cannot be silently adopted as the selected revision', async () => {
  const f = fixture(); f.hook(async () => {f.target.epoch = randomUUID();});
  await assert.rejects(f.controller.select(f.scope), e => e.status === 409);
  assert.equal(f.rpcs[0].closed, true); assert.equal(f.controller.status().selectionId, null);
  assert.equal(f.requests.some(r => r.method === 'turn/start'), false);
});
test('turn start still rechecks native target binding after product selection', async () => {
  const f = fixture(), selected = await f.controller.select(f.scope);
  f.target.manifestHash = 'changed';
  await assert.rejects(f.controller.startTurn(selected.selectionId, 'Use stale selection'));
  assert.equal(f.requests.some(r => r.method === 'turn/start'), false);
  assert.equal(f.controller.status().phase, 'closed'); await f.controller.close();
});
test('pending selection has scoped cancellation that aborts the opener and waits for cleanup', async () => {
  const f = fixture(), entered = latch(); let observedSignal;
  f.hook(({signal}) => new Promise((resolve, reject) => {
    observedSignal = signal; entered.resolve();
    signal.addEventListener('abort', () => reject(Error('Private opener error')), {once: true});
  }));
  const opening = f.controller.select(f.scope); const rejected = assert.rejects(opening, e => e.status === 409 && !e.message.includes('Private'));
  await entered.promise; const status = f.controller.status();
  assert.equal(status.phase, 'opening'); assert.ok(status.selectionId);
  await assert.rejects(f.controller.stop(randomUUID()), e => e.status === 409);
  assert.equal(observedSignal.aborted, false);
  assert.deepEqual(await f.controller.stop(status.selectionId), {closed: true}); await rejected;
  assert.equal(observedSignal.aborted, true); assert.equal(f.rpcs.length, 0);
  assert.equal(f.controller.status().phase, 'disconnected');
});
test('replacement waits for an uncooperative late opener to close before opening another transport', async () => {
  const f = fixture(), entered = latch(), release = latch();
  f.hook(async () => {entered.resolve(); await release.promise;});
  const first = f.controller.select(f.scope), rejected = assert.rejects(first, e => e.status === 409);
  await entered.promise;
  const second = f.controller.select({...f.scope, mode: 'agent'});
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.opens(), 1);
  release.resolve(); await rejected; const accepted = await second;
  assert.equal(f.rpcs[0].closed, true); assert.equal(f.opens(), 2); assert.equal(accepted.scope.mode, 'agent');
  await f.controller.close();
});
test('controller close awaits a pending opener even when its transport close rejects', async () => {
  const f = fixture(), entered = latch(), release = latch(), failure = Error('Synthetic transport cleanup failure');
  let opens = 0;
  const rpc = {closed: false, toolSession: null,
    async request(method) {assert.equal(method, 'thread/start'); entered.resolve(); await release.promise; return {thread: {id: 'late-thread'}};},
    async close() {this.closed = true; throw failure;},
  };
  const controller = new ProductProviderController({gate: f.gate, requireMode: () => {}, openTransport: async () => {opens++; return rpc;}});
  const selecting = controller.select(f.scope), selectionRejected = assert.rejects(selecting, error => error.status === 409);
  await entered.promise;
  let settled = false;
  const closing = controller.close(), rejected = assert.rejects(closing, error => error === failure).then(() => {settled = true;});
  assert.equal(controller.status().phase, 'disconnected');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  release.resolve(); await selectionRejected; await rejected;
  await assert.rejects(controller.select(f.scope));
  assert.equal(opens, 1); assert.equal(rpc.closed, true);
  await assert.rejects(controller.close(), error => error === failure);
});
test('transport-initiated close must finish ownership cleanup before controller shutdown or replacement', async () => {
  const f = fixture(), entered = latch(), release = latch();
  await f.controller.select(f.scope);
  const rpc = f.rpcs[0], close = rpc.close.bind(rpc); let transportClosing;
  rpc.close = () => transportClosing ||= (async () => {await close(); entered.resolve(); await release.promise;})();
  const failingTransport = rpc.close(); await entered.promise;
  assert.equal(rpc.closed, true); assert.equal(f.controller.status().phase, 'closed');
  let settled = false;
  const closing = f.controller.close().then(() => {settled = true;});
  const replacement = f.controller.select(f.scope);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(f.opens(), 1);
  release.resolve(); await failingTransport; await closing;
  assert.equal((await replacement).phase, 'ready'); assert.equal(f.opens(), 2);
  assert.equal(rpc.closed, true); await f.controller.close();
});
for (const cleanupFails of [false, true]) {
  test(`late-opening rejection awaits an already-closing profile and sanitizes cleanup failure=${cleanupFails}`, async () => {
    const f = fixture(), targetEntered = latch(), targetRelease = latch(), transportEntered = latch(), transportRelease = latch();
    const resolveTarget = f.gate.resolveTarget;
    let paused = false;
    f.gate.resolveTarget = async () => {
      // The session has completed its own checks; pause specifically in the
      // controller's final target check, before it adopts the active transport.
      if (!paused && f.rpcs[0]?.toolSession?.snapshot().phase === 'ready') {
        paused = true; targetEntered.resolve(); await targetRelease.promise;
        f.target.epoch = randomUUID();
      }
      return resolveTarget();
    };
    let selectionSettled = false;
    const selecting = f.controller.select(f.scope);
    const selectionRejected = assert.rejects(selecting, error => error.status === 409 && !error.message.includes('private'))
      .then(() => {selectionSettled = true;});
    await targetEntered.promise;
    const rpc = f.rpcs[0], close = rpc.close.bind(rpc), failure = Error('private profile cleanup diagnostic');
    let transportClosing;
    rpc.close = () => transportClosing ||= (async () => {
      await close(); transportEntered.resolve(); await transportRelease.promise;
      if (cleanupFails) throw failure;
    })();
    const transport = rpc.close(), transportDone = cleanupFails ? assert.rejects(transport, error => error === failure) : transport;
    await transportEntered.promise; assert.equal(rpc.closed, true);
    targetRelease.resolve(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(selectionSettled, false);
    let shutdownSettled = false;
    const shutdown = f.controller.close();
    const shutdownDone = (cleanupFails ? assert.rejects(shutdown, error => error === failure) : shutdown)
      .then(() => {shutdownSettled = true;});
    await new Promise(resolve => setImmediate(resolve)); assert.equal(shutdownSettled, false);
    transportRelease.resolve(); await transportDone; await selectionRejected; await shutdownDone;
    assert.equal(f.opens(), 1);
    if (cleanupFails) {
      await assert.rejects(f.controller.select(f.scope), error => !error.message.includes('private'));
      assert.equal(f.opens(), 1); await assert.rejects(f.controller.close(), error => error === failure);
    } else await f.controller.close();
  });
}
test('aborted HTTP selection cannot leave an agent opening or activated', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(f.controller.select(f.scope, {signal: abort.signal}), e => e.status === 409);
  await f.controller.close(); assert.equal(f.opens(), 0); assert.equal(f.controller.status().phase, 'disconnected');
  const entered = latch(), lateAbort = new AbortController();
  f.hook(({signal}) => new Promise((resolve, reject) => {
    entered.resolve(); signal.addEventListener('abort', () => reject(Error('Aborted')), {once: true});
  }));
  const pending = f.controller.select(f.scope, {signal: lateAbort.signal}), rejected = assert.rejects(pending, e => e.status === 409);
  await entered.promise; lateAbort.abort(); await rejected; await f.controller.close();
  assert.equal(f.controller.status().selectionId, null); assert.equal(f.rpcs.length, 0);
});
test('transcript projects bounded matching-turn text only and old selections cannot read it', async () => {
  const f = fixture(), selection = await f.controller.select(f.scope);
  const turn = await f.controller.startTurn(selection.selectionId, 'Visible user prompt');
  const emit = (method, params) => f.rpcs[0].toolSession.handleEvent({method, params: {...turn, ...params}});
  await emit('item/agentMessage/delta', {itemId: 'message', delta: 'Hello '});
  await emit('item/agentMessage/delta', {itemId: 'message', delta: 'world'});
  await emit('item/agentMessage/delta', {turnId: 'foreign', itemId: 'forged', delta: 'Hidden'});
  await emit('item/completed', {item: {id: 'tool', type: 'mcpToolCall', text: 'Private diagnostic'}});
  let transcript = f.controller.transcript(selection.selectionId);
  assert.deepEqual(transcript.messages.map(m => m.text), ['Visible user prompt', 'Hello world']);
  await emit('item/completed', {item: {id: 'message', type: 'agentMessage', text: 'x'.repeat(40000)}});
  transcript = f.controller.transcript(selection.selectionId);
  assert.equal(transcript.messages[1].text.length, 32000); assert.equal(transcript.messages[1].truncated, true);
  transcript.messages[0].text = 'Cannot mutate controller';
  assert.equal(f.controller.transcript(selection.selectionId).messages[0].text, 'Visible user prompt');
  await f.controller.select(f.scope);
  assert.throws(() => f.controller.transcript(selection.selectionId), e => e.status === 409);
  assert.deepEqual(f.controller.transcript(f.controller.status().selectionId).messages, []);
  await f.controller.close();
});
test('closing the real HTTP selection request aborts its opener and leaves no owned session', async () => {
  const f = fixture(), entered = latch(), aborted = latch();
  f.hook(({signal}) => new Promise((resolve, reject) => {
    entered.resolve(); signal.addEventListener('abort', () => {aborted.resolve(); reject(Error('Aborted fixture'));}, {once: true});
  }));
  const app = express(); app.use(express.json()); productProviderRoutes(app, f.controller);
  app.use((error, req, res, next) => {if (!res.destroyed) res.status(error.status || 400).json({error: 'Fixture error'});});
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const abort = new AbortController(), url = `http://127.0.0.1:${server.address().port}`;
    const result = fetch(url + '/api/provider/product/select', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(f.scope), signal: abort.signal});
    const rejected = assert.rejects(result, e => e.name === 'AbortError');
    await entered.promise; abort.abort(); await rejected; await aborted.promise; await f.controller.close();
    assert.equal(f.controller.status().selectionId, null); assert.equal(f.rpcs.length, 0);
  } finally {await f.controller.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
});
