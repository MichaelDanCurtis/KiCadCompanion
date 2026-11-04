import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {productApprovalFixture} from './fixtures/product-approval.mjs';

const body = result => JSON.parse(result.contentItems[0].text);
async function fixture(t) {
  const f = await productApprovalFixture();
  t.after(async () => {try {await f.controller.close();} catch (error) {if (!f.gate.broken) throw error;}});
  const selection = await f.controller.select(f.scope);
  await f.controller.startTurn(selection.selectionId, 'Fixture approval journey');
  return {...f, selection};
}
async function pendingAction(f) {
  // Bounded readiness observation, not an assumption based on a fixed sleep.
  for (let i = 0; i < 200; i++) {
    const action = f.gate.list(f.scope.projectId).actions.at(-1);
    if (action) {await f.gate.queue(async () => {}); return action;}
    await delay(10);
  }
  throw Error('Fixture proposal did not reach the journal');
}

for (const decision of ['once', 'always', 'decline']) {
  test(`product prepare waits for host ${decision}, never self-approves or auto-executes`, {timeout: 5000}, async t => {
    const f = await fixture(t);
    let settled = false;
    const pending = f.propose().then(result => {settled = true; return result;});
    const action = await pendingAction(f);
    await delay(20);
    assert.equal(settled, false); assert.equal(f.controller.status().phase, 'working');
    assert.equal(action.state, 'awaiting-approval'); assert.equal(f.adapter.calls, 0);
    assert.equal((await f.call('benchline_decide', {actionId: action.id, decision: 'always'})).success, false);
    await f.gate.decide(action.id, decision);
    assert.equal(body(await pending).state, decision === 'decline' ? 'declined' : 'approved');
    assert.equal(f.adapter.calls, 0);
    const executed = await f.call('benchline_execute_action', {actionId: action.id});
    assert.equal(executed.success, decision !== 'decline');
    assert.equal(f.adapter.calls, decision === 'decline' ? 0 : 1);
    assert.equal(f.gate.list(f.scope.projectId).grants.length, decision === 'always' ? 1 : 0);
  });
}

for (const end of ['stop', 'disconnect', 'completion', 'replace']) {
  test(`product ${end} releases a pending approval without dispatch`, {timeout: 5000}, async t => {
    const f = await fixture(t), pending = f.propose(), action = await pendingAction(f);
    const rpc = f.rpcs.at(-1), before = rpc.toolSession.snapshot();
    if (end === 'completion') await rpc.toolSession.handleEvent({method: 'turn/completed', params: {
      threadId: before.threadId, turn: {id: before.turnId},
    }});
    else if (end === 'replace') await f.controller.select({...f.scope, mode: 'discuss'});
    else await f.controller[end](f.selection.selectionId);
    assert.equal((await pending).success, false);
    assert.equal(f.gate.get(action.id).state, 'cancelled'); assert.equal(f.adapter.calls, 0);
    await assert.rejects(f.gate.decide(action.id, 'once'));
    if (end === 'stop') assert.ok(f.requests.some(r => r.method === 'turn/interrupt'));
  });
}

test('product wait expires durably without any approval, grant or dispatch', {timeout: 5000}, async t => {
  const f = await fixture(t), pending = f.propose(), action = await pendingAction(f);
  f.advance(60001);
  assert.equal(body(await pending).state, 'expired');
  assert.equal(f.gate.get(action.id).state, 'expired');
  await assert.rejects(f.gate.decide(action.id, 'always'));
  assert.equal(f.gate.list(f.scope.projectId).grants.length, 0); assert.equal(f.adapter.calls, 0);
});

test('approval is never returned before its journal write succeeds', {timeout: 5000}, async t => {
  const f = await fixture(t), pending = f.propose(), action = await pendingAction(f);
  // Force the real save path to fail without touching any existing file.
  f.gate.path = f.root;
  await assert.rejects(f.gate.decide(action.id, 'once'));
  assert.equal((await pending).success, false); assert.equal(f.gate.broken, true);
  assert.equal(f.adapter.calls, 0);
  // A broken gate rejects cleanup; the test must still revoke the transport.
  await assert.rejects(f.controller.close());
});

test('changed scope while waiting cannot release an approved action to the agent', {timeout: 5000}, async t => {
  const f = await fixture(t), pending = f.propose(), action = await pendingAction(f);
  await f.gate.decide(action.id, 'once'); f.target.manifestHash = 'changed';
  assert.equal((await pending).success, false);
  assert.equal(f.gate.get(action.id).state, 'cancelled'); assert.equal(f.adapter.calls, 0);
});

test('product recurring grant skips waiting only for its exact fresh scope', {timeout: 5000}, async t => {
  const f = await fixture(t), pending = f.propose(), action = await pendingAction(f);
  await f.gate.decide(action.id, 'always'); await pending;
  await f.call('benchline_execute_action', {actionId: action.id});
  const second = body(await f.propose()); assert.equal(second.state, 'approved');
  const changed = f.propose('Different arguments');
  // Wait specifically for the third proposal.
  for (let i = 0; i < 200 && f.gate.list(f.scope.projectId).actions.length < 3; i++) await delay(10);
  const third = f.gate.list(f.scope.projectId).actions.at(-1);
  assert.equal(third.state, 'awaiting-approval');
  await f.gate.decide(third.id, 'decline'); assert.equal(body(await changed).state, 'declined');
  assert.equal(f.adapter.calls, 1);
});
