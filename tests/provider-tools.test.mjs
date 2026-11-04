import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ActionGate} from '../server/actions.mjs';
import {FixtureAdapter} from '../server/adapters/fixture.mjs';
import {createProviderToolSession} from '../server/provider-tools.mjs';
import {CodexAgent} from '../server/codex.mjs';

const body = response => JSON.parse(response.contentItems[0].text);
const latch = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
async function fixture(mode = 'agent') {
  const root = await mkdtemp(join(tmpdir(), 'benchline-provider-'));
  const adapter = new FixtureAdapter(), projectId = randomUUID(), documentId = randomUUID();
  const target = {projectId, documentId, path: join(root, 'fixture.txt'), epoch: randomUUID(), manifestHash: 'initial'};
  const gate = new ActionGate({path: join(root, 'actions.json'), adapters: new Map([['fixture', adapter]]),
    resolveTarget: async input => {assert.equal(input.projectId, projectId); assert.equal(input.documentId, documentId); return structuredClone(target);}});
  await gate.init();
  const options = {gate, projectId, documentIds: [documentId], mode, threadId: 'thread-1'};
  const session = await createProviderToolSession(options); session.beginTurn('turn-1');
  let count = 0;
  const request = (tool, args, overrides = {}) => ({id: ++count, method: 'item/tool/call', params: {
    threadId: 'thread-1', turnId: 'turn-1', callId: `call-${count}`, tool, arguments: args, ...overrides,
  }});
  const proposal = (extra = {}) => ({documentId, adapter: 'fixture', operation: 'set-label', args: {value: 'Approved'}, ...extra});
  const prepare = (args = proposal()) => session.handle(request('benchline_prepare_action', args));
  const execute = id => session.handle(request('benchline_execute_action', {actionId: id}));
  return {gate, adapter, target, options, session, request, proposal, prepare, execute};
}

test('provider mode and document authority belong to the host, not arguments or mutable options', async () => {
  const f = await fixture('discuss');
  f.options.mode = 'agent'; f.options.documentIds.push(randomUUID());
  assert.equal((await f.prepare()).success, false);
  for (const extra of [{mode: 'agent'}, {projectId: randomUUID()}, {path: '/outside'}, {decision: 'always'}, {idempotencyKey: randomUUID()}]) {
    assert.equal((await f.prepare({...f.proposal(), ...extra})).success, false);
  }
  assert.equal((await f.prepare(f.proposal({documentId: randomUUID()}))).success, false);
  assert.equal((await f.prepare(f.proposal({operation: 'shell', args: {command: 'write anything'}}))).success, false);
  const result = await f.prepare(f.proposal({operation: 'read-label', args: {}}));
  assert.equal(body(result).state, 'ready');
  assert.equal((await f.execute(body(result).actionId)).success, true);
  assert.equal(f.adapter.value, 'initial'); assert.equal(f.adapter.calls, 1);
  assert.equal(f.gate.list(f.target.projectId).actions[0].input.mode, 'discuss');
});

test('agent can propose and execute only after a host decision; no self-approval route exists', async () => {
  const f = await fixture(), prepared = body(await f.prepare());
  assert.equal(prepared.state, 'awaiting-approval');
  assert.equal((await f.execute(prepared.actionId)).success, false);
  for (const tool of ['benchline_decide', 'benchline_grant', 'benchline_inspect', 'benchline_reconcile', 'benchline_recovery_review', 'shell', 'mcp__konnect__move_component']) {
    assert.equal((await f.session.handle(f.request(tool, {actionId: prepared.actionId, decision: 'always'}))).success, false);
  }
  assert.equal(f.adapter.calls, 0);
  await f.gate.decide(prepared.actionId, 'once');
  assert.equal(body(await f.execute(prepared.actionId)).state, 'verified');
  assert.equal(body(await f.execute(prepared.actionId)).state, 'verified');
  assert.equal(f.adapter.calls, 1); assert.equal(f.gate.list(f.target.projectId).grants.length, 0);
});

test('protocol duplicate calls coalesce, but changed arguments under a call ID are denied', async () => {
  const f = await fixture(), r = f.request('benchline_prepare_action', f.proposal());
  const results = await Promise.all([f.session.handle(r), f.session.handle({...r, id: 999})]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.gate.list(f.target.projectId).actions.length, 1);
  const changed = structuredClone(r); changed.params.arguments.args.value = 'Changed';
  assert.equal((await f.session.handle(changed)).success, false);
  await f.gate.decide(body(results[0]).actionId, 'once');
  const execute = f.request('benchline_execute_action', {actionId: body(results[0]).actionId});
  await Promise.all([f.session.handle(execute), f.session.handle({...execute, id: 998})]);
  assert.equal(f.adapter.calls, 1);
});

test('wrong threads, turns, namespaces, malformed and oversized requests never reach the gate', async () => {
  const f = await fixture();
  for (const change of [{threadId: 'other'}, {turnId: 'other'}, {namespace: 'konnect'}]) {
    assert.equal((await f.session.handle(f.request('benchline_prepare_action', f.proposal(), change))).success, false);
  }
  assert.equal((await f.session.handle({id: 1, method: 'item/tool/call'})).success, false);
  assert.equal((await f.execute('not-a-uuid')).success, false);
  assert.equal((await f.prepare(f.proposal({args: {value: 'x'.repeat(33000)}}))).success, false);
  assert.equal(f.gate.list(f.target.projectId).actions.length, 0); assert.equal(f.adapter.calls, 0);
});

test('actions from another session, turn or direct UI request are not provider-owned', async () => {
  const f = await fixture(), id = body(await f.prepare()).actionId;
  const other = await createProviderToolSession(f.options); other.beginTurn('turn-1');
  assert.equal((await other.handle(f.request('benchline_action_status', {actionId: id}))).success, false);
  const manual = await f.gate.prepare({...f.proposal(), projectId: f.target.projectId, mode: 'agent', idempotencyKey: randomUUID()});
  assert.equal((await f.execute(manual.id)).success, false);
  await f.session.endTurn('turn-1'); f.session.beginTurn('turn-2');
  assert.equal((await f.session.handle(f.request('benchline_execute_action', {actionId: id}, {turnId: 'turn-2'}))).success, false);
  assert.equal(f.gate.get(id).state, 'cancelled'); assert.equal(f.adapter.calls, 0);
  await f.session.endTurn('turn-2'); assert.throws(() => f.session.beginTurn('turn-1'));
});

test('project relocation and manifest changes invalidate session targets, including prepare races', async () => {
  const f = await fixture(); f.target.epoch = randomUUID();
  assert.equal((await f.prepare()).success, false); assert.equal(f.gate.list(f.target.projectId).actions.length, 0);
  const g = await fixture(), resolve = g.gate.resolveTarget;
  let calls = 0;
  g.gate.resolveTarget = async input => {if (++calls === 2) g.target.manifestHash = 'changed-during-prepare'; return resolve(input);};
  assert.equal((await g.prepare()).success, false);
  assert.equal(g.gate.list(g.target.projectId).actions[0].state, 'cancelled'); assert.equal(g.adapter.calls, 0);
});

test('ending a turn during prepare cancels the newly persisted action', async () => {
  const f = await fixture(), entered = latch(), release = latch(), original = f.adapter.preview.bind(f.adapter);
  f.adapter.preview = async (...args) => {entered.resolve(); await release.promise; return original(...args);};
  const pending = f.prepare(); await entered.promise;
  await f.session.endTurn('turn-1'); release.resolve();
  assert.equal((await pending).success, false);
  assert.equal(f.gate.list(f.target.projectId).actions[0].state, 'cancelled'); assert.equal(f.adapter.calls, 0);
});

test('closing during execution preflight cancels before native dispatch', async () => {
  const f = await fixture(), id = body(await f.prepare()).actionId;
  await f.gate.decide(id, 'once');
  const entered = latch(), release = latch(), original = f.adapter.preview.bind(f.adapter);
  f.adapter.preview = async (...args) => {entered.resolve(); await release.promise; return original(...args);};
  const executing = f.execute(id); await entered.promise;
  const closing = f.session.close(); release.resolve();
  assert.equal((await executing).success, false); await closing;
  assert.equal(f.adapter.calls, 0); assert.throws(() => f.session.beginTurn('turn-new'));
});

test('closing after dispatch does not promise rollback; verified receipt remains in host journal', async () => {
  const f = await fixture(), id = body(await f.prepare()).actionId;
  await f.gate.decide(id, 'once');
  const entered = latch(), release = latch(), original = f.adapter.execute.bind(f.adapter);
  f.adapter.execute = async (...args) => {entered.resolve(); await release.promise; return original(...args);};
  const executing = f.execute(id); await entered.promise; await f.session.close(); release.resolve();
  assert.equal((await executing).success, false); assert.equal(f.adapter.calls, 1);
  assert.equal(f.gate.get(id).state, 'verified'); assert.match(f.gate.get(id).detail, /not undone/);
});

test('decline, revoke, stale revisions and unknown outcomes remain enforced through mediated execution', async () => {
  const f = await fixture(); let id = body(await f.prepare()).actionId;
  await f.gate.decide(id, 'decline'); assert.equal((await f.execute(id)).success, false);
  id = body(await f.prepare()).actionId; await f.gate.decide(id, 'always');
  await f.gate.revoke(f.gate.get(id).grantId); assert.equal((await f.execute(id)).success, false);
  id = body(await f.prepare()).actionId; await f.gate.decide(id, 'once'); f.adapter.revision++;
  assert.equal(body(await f.execute(id)).state, 'failed'); assert.equal(f.adapter.calls, 0);
  id = body(await f.prepare()).actionId; await f.gate.decide(id, 'once');
  f.adapter.execute = async () => {f.adapter.calls++; throw Error('private-path /credentials/private-token');};
  const result = await f.execute(id);
  assert.equal(body(result).state, 'unknown'); assert.equal(result.success, false);
  assert.doesNotMatch(JSON.stringify(result), /private-path|credentials|private-token/);
  await f.execute(id); assert.equal(f.adapter.calls, 1);
  assert.equal((await f.prepare()).success, false);
});

test('scoped host always grant still requires a fresh proposal; changed arguments ask again', async () => {
  const f = await fixture(); let id = body(await f.prepare()).actionId;
  await f.gate.decide(id, 'always'); await f.execute(id);
  const next = body(await f.prepare()); assert.equal(next.state, 'approved');
  assert.equal(body(await f.execute(next.actionId)).state, 'verified'); assert.equal(f.adapter.calls, 2);
  const changed = body(await f.prepare(f.proposal({args: {value: 'Different'}})));
  assert.equal(changed.state, 'awaiting-approval');
  assert.equal((await f.execute(changed.actionId)).success, false);
});

test('Codex callback bridge mediates tools and rejects legacy approvals without spawning a provider', async () => {
  const f = await fixture(), sent = [], legacy = [];
  const agent = new CodexAgent({toolSession: f.session, onRequest: r => legacy.push(r), onEvent: () => {}, onStatus: () => {}});
  agent.send = message => sent.push(message);
  await agent.receive(f.request('benchline_prepare_action', f.proposal()));
  assert.equal(body(sent[0].result).state, 'awaiting-approval');
  agent.receive({id: 900, method: 'item/commandExecution/requestApproval', params: {}});
  agent.receive({id: 901, method: 'mcpServer/elicitation/request', params: {}});
  assert.ok(sent.slice(1).every(m => m.error.code === -32601)); assert.equal(legacy.length, 0);
  await assert.rejects(agent.connect(), /paused/); assert.equal(agent.process, undefined);
  agent.close(); assert.equal((await f.prepare()).success, false);
});

test('dynamic tool definitions expose only the three mediated operations and no permission inputs', async () => {
  const f = await fixture(), tools = f.session.tools();
  assert.equal(tools.length, 3);
  for (const tool of tools) {assert.equal(tool.type, 'function'); assert.equal(tool.inputSchema.additionalProperties, false);}
  const fields = Object.keys(tools[0].inputSchema.properties);
  assert.deepEqual(fields, ['documentId', 'adapter', 'operation', 'args']);
  tools[0].inputSchema.properties.documentId.enum.push(randomUUID());
  assert.deepEqual(f.session.tools()[0].inputSchema.properties.documentId.enum, [f.target.documentId]);
  assert.ok(Object.isFrozen(f.session));
});

test('matching completion notifications invalidate the turn; foreign or duplicate events do not expand authority', async () => {
  const f = await fixture(), id = body(await f.prepare()).actionId;
  const agent = new CodexAgent({toolSession: f.session, onEvent: () => {}, onStatus: () => {}});
  await agent.receive({method: 'turn/completed', params: {threadId: 'foreign', turn: {id: 'turn-1'}}});
  assert.equal(f.gate.get(id).state, 'awaiting-approval');
  await agent.receive({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1'}}});
  assert.equal(f.gate.get(id).state, 'cancelled'); assert.equal((await f.execute(id)).success, false);
  await agent.receive({method: 'turn/completed', params: {threadId: 'thread-1', turn: {id: 'turn-1'}}});
  f.session.beginTurn('turn-2');
  await agent.receive({method: 'thread/closed', params: {threadId: 'thread-1'}});
  assert.throws(() => f.session.beginTurn('turn-3')); assert.equal(f.adapter.calls, 0);
});

test('a failed tool-response transport closes the session without an unhandled rejection or replay', async () => {
  const f = await fixture(), statuses = [];
  const agent = new CodexAgent({toolSession: f.session, onStatus: s => statuses.push(s), onEvent: () => {}});
  agent.send = () => {throw Error('sensitive transport details');};
  await agent.receive(f.request('benchline_prepare_action', f.proposal()));
  assert.equal(statuses[0].connected, false);
  assert.doesNotMatch(statuses[0].error, /sensitive transport/);
  await f.gate.pending;
  assert.equal(f.gate.list(f.target.projectId).actions[0].state, 'cancelled');
  assert.equal((await f.prepare()).success, false); assert.equal(f.adapter.calls, 0);
});
