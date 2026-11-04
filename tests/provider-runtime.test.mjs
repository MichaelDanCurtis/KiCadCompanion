import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderRuntime} from '../server/provider-runtime.mjs';

const configured = {enabled: true, binary: '/host/codex', root: '/host/managed-profile', model: 'exact-selected-model'};
function fixture(change = {}) {
  const calls = [], rpc = {close: async () => {calls.push(['close']);}};
  const host = async () => {};
  const dependencies = {
    verifyRuntime: async args => {calls.push(['verify', args]);},
    openHost: host,
    openProfile: async args => {calls.push(['profile', args]); return {rpc, cwd: '/host/empty'};},
    openModel: async args => {calls.push(['model', args]); assert.equal((await args.openProfile()).rpc, rpc); return rpc;},
    ...change,
  };
  return {calls, rpc, host, dependencies, create: options => createProviderRuntime(options ?? configured, dependencies)};
}

test('runtime defaults off and missing host configuration never probes or opens a profile', async () => {
  for (const input of [undefined, {}, {...configured, enabled: false}, {...configured, enabled: 'true'},
    {...configured, model: ''}, {...configured, model: '   '}, {...configured, model: undefined},
    {...configured, root: '/'}, {...configured, binary: 'relative'}, {...configured, root: 'relative'}]) {
    const f = fixture(), runtime = await createProviderRuntime(input, f.dependencies);
    assert.equal(runtime.boundary.modes.discuss.supported, false);
    assert.equal(runtime.boundary.modes.agent.supported, false);
    assert.throws(() => runtime.requireMode('discuss'), {status: 422});
    await assert.rejects(runtime.openTransport(), {status: 422});
    assert.deepEqual(f.calls, []);
  }
});

test('startup pin failure stays unsupported without revealing raw errors or falling back', async () => {
  const f = fixture({verifyRuntime: async () => {throw Error('private path or diagnostics');}});
  const runtime = await f.create();
  assert.equal(runtime.boundary.modes.agent.supported, false);
  assert.doesNotMatch(JSON.stringify(runtime.boundary), /private path/);
  await assert.rejects(runtime.openTransport(), {status: 422});
  assert.deepEqual(f.calls, []);
});

test('default verifier treats a missing executable as unsupported without profile setup', async () => {
  const runtime = await createProviderRuntime({...configured, binary: '/benchline-test-nonexistent/codex'});
  assert.equal(runtime.boundary.modes.agent.supported, false);
  await assert.rejects(runtime.openTransport(), {status: 422});
});

test('capability view is deeply immutable and qualification does not create profiles or call models', async () => {
  const f = fixture(), runtime = await f.create();
  assert.deepEqual(f.calls, [['verify', {binary: configured.binary}]]);
  for (const value of [runtime, runtime.boundary, runtime.boundary.modes, runtime.boundary.modes.agent, runtime.boundary.modes.discuss]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.throws(() => {runtime.boundary.modes.agent.supported = false;}, TypeError);
  runtime.requireMode('agent'); runtime.requireMode('discuss');
  assert.throws(() => runtime.requireMode('shell'), {status: 422});
  assert.throws(() => runtime.requireMode('__proto__'), {status: 422});
  assert.equal(f.calls.length, 1);
});

test('opening pins the exact host-selected model and owned gateway without a fallback', async () => {
  const f = fixture(), options = {...configured}, runtime = await f.create(options);
  options.model = 'changed-later'; options.root = '/wrong';
  const abort = new AbortController();
  assert.equal(await runtime.openTransport({signal: abort.signal}), f.rpc);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['verify', 'verify', 'profile', 'model']);
  assert.deepEqual(f.calls[2][1], {binary: configured.binary, root: configured.root, signal: abort.signal, candidateHostFactory: f.host});
  const args = f.calls[3][1];
  assert.equal(args.model, configured.model);
  assert.equal(args.binary, configured.binary); assert.equal(args.root, configured.root);
  assert.equal(args.signal, abort.signal);
});

test('runtime drift at open fails before profile creation', async () => {
  let checks = 0;
  const f = fixture({verifyRuntime: async () => {if (++checks > 1) throw Error('changed executable');}});
  const runtime = await f.create();
  await assert.rejects(runtime.openTransport(), {status: 422});
  assert.equal(checks, 2); assert.deepEqual(f.calls, []);
});

test('pre-aborted opening never acquires a profile', async () => {
  const f = fixture(), runtime = await f.create(), abort = new AbortController(); abort.abort();
  await assert.rejects(runtime.openTransport({signal: abort.signal}), {name: 'AbortError'});
  assert.deepEqual(f.calls.map(([kind]) => kind), ['verify']);
});

test('late profile completion after cancellation is closed before rejecting', async () => {
  const abort = new AbortController();
  const f = fixture();
  f.dependencies.openProfile = async () => {abort.abort(); return {rpc: f.rpc, cwd: '/empty'};};
  const runtime = await f.create();
  await assert.rejects(runtime.openTransport({signal: abort.signal}), {name: 'AbortError'});
  assert.deepEqual(f.calls.map(([kind]) => kind), ['verify', 'verify', 'close']);
});

test('model-open errors close the acquired profile and sanitize diagnostics', async () => {
  const f = fixture({openModel: async () => {throw Error('private account diagnostics');}});
  const runtime = await f.create();
  await assert.rejects(runtime.openTransport(), error => error.status === 422 && !error.message.includes('private'));
  assert.deepEqual(f.calls.map(([kind]) => kind), ['verify', 'verify', 'profile', 'close']);
});

test('model-open rejection waits for profile cleanup before returning failure', async () => {
  let release, entered;
  const cleaned = new Promise(resolve => {release = resolve;}), closing = new Promise(resolve => {entered = resolve;});
  const f = fixture({openModel: async () => {throw Error('model refused');}});
  f.rpc.close = async () => {entered(); await cleaned;};
  const runtime = await f.create(); let settled = false;
  const result = runtime.openTransport().finally(() => {settled = true;});
  const rejected = assert.rejects(result, {status: 422});
  await closing; assert.equal(settled, false);
  release(); await rejected; assert.equal(settled, true);
});

test('cancellation during model-open closes the acquired profile', async () => {
  const abort = new AbortController(), f = fixture();
  f.dependencies.openModel = async () => {abort.abort(); return f.rpc;};
  const runtime = await f.create();
  await assert.rejects(runtime.openTransport({signal: abort.signal}), {name: 'AbortError'});
  assert.deepEqual(f.calls.map(([kind]) => kind), ['verify', 'verify', 'profile', 'close']);
});
