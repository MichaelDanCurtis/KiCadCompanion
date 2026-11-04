import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ActionGate} from '../server/actions.mjs';
import {FixtureAdapter} from '../server/adapters/fixture.mjs';
import {CodexAgent} from '../server/codex.mjs';
import {MediatedProviderSession} from '../server/provider-session.mjs';

const latch = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
const body = result => JSON.parse(result.contentItems[0].text);
async function fixture(mode = 'agent') {
  const root = await mkdtemp(join(tmpdir(), 'benchline-session-'));
  const adapter = new FixtureAdapter(), projectId = randomUUID(), documentId = randomUUID();
  const target = {projectId, documentId, path: join(root, 'fixture.txt'), epoch: randomUUID(), manifestHash: 'initial'};
  const gate = new ActionGate({path: join(root, 'actions.json'), adapters: new Map([['fixture', adapter]]),
    resolveTarget: async () => structuredClone(target)}); await gate.init();
  const requests = [], events = [], sent = [];
  const rpc = new CodexAgent(), scope = {projectId, documentIds: [documentId], mode};
  rpc.send = message => sent.push(message);
  let turn = 0, hook = null;
  rpc.request = async (method, params) => {
    requests.push({method, params});
    if (hook) {const response = await hook(method, params); if (response !== undefined) return response;}
    if (method === 'thread/start') return {thread: {id: 'thread-1'}};
    if (method === 'turn/start') return {turn: {id: `turn-${++turn}`}};
    return {};
  };
  const session = await MediatedProviderSession.open({rpc, gate, scope, onEvent: m => events.push(m)});
  let calls = 0;
  const request = (tool = 'benchline_prepare_action', args = {documentId, adapter: 'fixture', operation: 'set-label', args: {value: 'approved'}}, override = {}) =>
    ({id: ++calls, method: 'item/tool/call', params: {threadId: 'thread-1', turnId: 'turn-1',
      callId: `call-${calls}`, tool, arguments: args, ...override}});
  return {session, rpc, gate, adapter, target, scope, requests, events, sent, request,
    hook: fn => hook = fn, complete: turnId => session.handleEvent({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: turnId, status: 'completed'}}})};
}

test('session starts fresh with host-owned scope and restrictive thread options', async () => {
  const f = await fixture('discuss'); f.scope.mode = 'agent'; f.scope.documentIds.push(randomUUID());
  assert.equal(f.session.snapshot().mode, 'discuss');
  assert.equal(f.requests[0].method, 'thread/start');
  assert.equal(f.requests[0].params.sandbox, 'read-only'); assert.equal(f.requests[0].params.approvalPolicy, 'never');
  assert.equal(f.requests[0].params.ephemeral, true); assert.equal(f.requests[0].params.dynamicTools.length, 3);
  assert.equal(f.requests[0].params.cwd, undefined);
  assert.equal((await f.session.handle(f.request())).success, false);
  await f.session.startTurn('Test'); assert.equal((await f.session.handle(f.request())).success, false);
  assert.equal(f.adapter.calls, 0); await f.session.close();
});
test('callbacks racing turn/start wait for its accepted ID, not their own asserted turn', async () => {
  const f = await fixture(), entered = latch(), release = latch();
  f.hook(async method => {if (method === 'turn/start') {entered.resolve(); await release.promise; return {turn: {id: 'accepted'}};}});
  const starting = f.session.startTurn('Test'); await entered.promise;
  const bad = f.session.handle(f.request()), good = f.session.handle(f.request(undefined, undefined, {turnId: 'accepted'}));
  assert.equal(f.gate.list(f.target.projectId).actions.length, 0);
  release.resolve(); await starting;
  assert.equal((await bad).success, false); assert.equal(body(await good).state, 'awaiting-approval');
  await f.session.close(); assert.equal(f.gate.list(f.target.projectId).actions[0].state, 'cancelled');
});
test('stop during startup revokes queued callbacks and closes without guessing an interrupt ID', async () => {
  const f = await fixture(), entered = latch(), release = latch();
  f.hook(async method => {if (method === 'turn/start') {entered.resolve(); await release.promise; return {turn: {id: 'turn-1'}};}});
  const starting = f.session.startTurn('Test'); await entered.promise;
  const callback = f.session.handle(f.request()); await f.session.stop(); release.resolve();
  await assert.rejects(starting, /changed/); assert.equal((await callback).success, false);
  assert.equal(f.requests.some(r => r.method === 'turn/interrupt'), false);
  assert.equal(f.session.snapshot().phase, 'closed'); assert.equal(f.rpc.closed, true); assert.equal(f.adapter.calls, 0);
});
test('stop revokes a pending action before sending interrupt and waits for matching completion', async () => {
  const f = await fixture(); await f.session.startTurn('Test');
  const actionId = body(await f.session.handle(f.request())).actionId;
  f.hook(async method => {if (method === 'turn/interrupt') assert.equal(f.gate.get(actionId).state, 'cancelled');});
  await f.session.stop(); assert.equal(f.session.snapshot().phase, 'stopping');
  await assert.rejects(f.session.startTurn('Too soon'));
  await f.complete('foreign'); assert.equal(f.session.snapshot().phase, 'stopping');
  await f.complete('turn-1'); assert.equal(f.session.snapshot().phase, 'ready');
  await f.session.startTurn('Next'); assert.equal(f.session.snapshot().turnId, 'turn-2'); await f.session.close();
});
test('overlapping turns and invalid input never dispatch another request', async () => {
  const f = await fixture();
  for (const value of ['', 'x'.repeat(16001), {text: 'Inject', sandbox: 'danger-full-access'}]) await assert.rejects(f.session.startTurn(value));
  assert.equal(f.requests.length, 1); await f.session.startTurn('Test');
  await assert.rejects(f.session.startTurn('Overlap')); assert.equal(f.requests.length, 2); await f.session.close();
});
test('manifest relocation invalidates scope before another model turn starts', async () => {
  const f = await fixture(); f.target.epoch = randomUUID();
  await assert.rejects(f.session.startTurn('Test'), /changed/);
  assert.equal(f.requests.length, 1); assert.equal(f.rpc.closed, true);
});
test('completion racing turn/start cancels pending authority and returns to ready', async () => {
  const f = await fixture(); let completing;
  f.hook(async method => {if (method === 'turn/start') {completing = f.complete('turn-1'); return {turn: {id: 'turn-1'}};}});
  await f.session.startTurn('Test'); await completing;
  assert.equal(f.session.snapshot().phase, 'ready'); assert.equal((await f.session.handle(f.request())).success, false);
  assert.equal(f.events.length, 1); await f.session.close();
});
test('transport failure closes the owning session and cancels approval without replay', async () => {
  const f = await fixture(); await f.session.startTurn('Test');
  const actionId = body(await f.session.handle(f.request())).actionId;
  f.rpc.fail(Error('private credentials')); await f.rpc.close();
  assert.equal(f.session.snapshot().phase, 'closed'); assert.equal(f.gate.get(actionId).state, 'cancelled');
  assert.equal(f.adapter.calls, 0); await assert.rejects(f.session.startTurn('Retry'));
});
test('another session cannot claim or close an owned transport', async () => {
  const f = await fixture();
  await assert.rejects(MediatedProviderSession.open({rpc: f.rpc, gate: f.gate, scope: f.scope}), /already belongs/);
  assert.equal(f.rpc.closed, false); assert.equal(f.rpc.toolSession, f.session); await f.session.close();
});
test('session close revokes immediately but waits for transport ownership after journal cleanup fails', async () => {
  const f = await fixture(), entered = latch(), release = latch(), failure = Error('Synthetic journal failure');
  await f.session.startTurn('Test'); await f.session.handle(f.request());
  f.gate.cancel = async () => {throw failure;};
  f.rpc.close = () => {f.rpc.closed = true; entered.resolve(); return release.promise;};
  let settled = false;
  const closing = f.session.close();
  const rejected = assert.rejects(closing, error => error === failure).then(() => {settled = true;});
  assert.equal(f.session.close(), closing);
  assert.equal(f.session.snapshot().phase, 'closed');
  assert.equal(f.rpc.toolSession, null);
  await entered.promise; await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal((await f.session.handle(f.request())).success, false);
  release.resolve(); await rejected; assert.equal(settled, true);
  assert.equal(f.adapter.calls, 0);
});
test('foreign events do not reach the project UI or revoke its turn', async () => {
  const f = await fixture(); await f.session.startTurn('Test');
  await f.session.handleEvent({method: 'thread/closed', params: {threadId: 'other'}});
  await f.session.handleEvent({method: 'item/agentMessage/delta', params: {threadId: 'thread-1', turnId: 'other', delta: 'foreign'}});
  assert.equal(f.events.length, 0); assert.equal(f.session.snapshot().phase, 'working'); await f.session.close();
});

test('transport denies host command/config/resume RPCs and cleans up synchronous send failures', async () => {
  const agent = new CodexAgent(); let sends = 0; agent.send = () => sends++;
  for (const method of ['process/spawn', 'fs/writeFile', 'thread/shellCommand', 'thread/resume', 'config/value/write']) await assert.rejects(agent.request(method, {}));
  assert.equal(sends, 0); assert.equal(agent.pending.size, 0);
  agent.send = () => {throw Error('private details');};
  await assert.rejects(agent.request('account/read', {}), /Provider transport failed/);
  assert.equal(agent.pending.size, 0); assert.equal(agent.closed, true);
});
test('transport timeout terminates authority rather than leaving a late request usable', async () => {
  const agent = new CodexAgent(); agent.send = () => {};
  await assert.rejects(agent.request('turn/start', {}, 5), /Provider transport failed/);
  assert.equal(agent.closed, true); assert.equal(agent.pending.size, 0);
});
test('attached transport preserves split UTF-8, rejects malformed frames and terminates once', async () => {
  const child = new EventEmitter(); Object.assign(child, {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null});
  let killed = 0; child.kill = () => {killed++; child.signalCode = 'SIGTERM'; child.emit('exit', null);};
  const events = [], statuses = [], agent = new CodexAgent({onEvent: e => events.push(e), onStatus: s => statuses.push(s)}).attach(child);
  const bytes = Buffer.from(JSON.stringify({method: 'delta', params: {text: 'Circuit ⚡'}}) + '\n');
  const index = bytes.indexOf(Buffer.from('⚡')) + 1;
  child.stdout.write(bytes.subarray(0, index)); child.stdout.write(bytes.subarray(index));
  assert.equal(events[0].params.text, 'Circuit ⚡');
  child.stdout.write('not JSON\n'); assert.equal(agent.closed, true); assert.equal(killed, 1); assert.equal(statuses.length, 1);
  assert.doesNotMatch(statuses[0].error, /not JSON/); await agent.close();
});
