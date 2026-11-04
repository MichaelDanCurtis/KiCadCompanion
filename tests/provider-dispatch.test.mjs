import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchAllowlist, sourceDispatchCandidate, assertSourceDispatchBinary, withoutSourceDispatchConfig} from '../server/provider-dispatch.mjs';
import {openCandidateSourceDispatchProfile} from '../server/provider-profile.mjs';

test('source dispatcher refuses missing gateway before opening any profile or binary', async () => {
  await assert.rejects(openCandidateSourceDispatchProfile({binary: '/must-not-open', root: '/must-not-open'}), /requires the owned candidate gateway/);
});

test('source dispatcher rejects changed binaries and versions', () => {
  assert.throws(() => assertSourceDispatchBinary(sourceDispatchCandidate.version, Buffer.from('other executable')), /requalification/);
  assert.throws(() => assertSourceDispatchBinary('codex-app-server other', Buffer.from('other executable')), /requalification/);
});

test('source effective allowlist is exact, nonmutating and cannot widen the baseline', () => {
  const config = {features: {code_mode: true, tool_registry: {execution_allowlist: structuredClone(dispatchAllowlist)}}, sentinel: 'preserved'};
  assert.deepEqual(withoutSourceDispatchConfig(config), {features: {code_mode: true}, sentinel: 'preserved'});
  assert.deepEqual(config.features.tool_registry.execution_allowlist, dispatchAllowlist);
  for (const registry of [undefined, {}, {execution_allowlist: {}},
    {execution_allowlist: {functions: [...dispatchAllowlist.functions, 'exec_command']}},
    {execution_allowlist: {functions: dispatchAllowlist.functions.slice(1)}},
    {execution_allowlist: {...dispatchAllowlist, clock: ['curr_time']}},
    {execution_allowlist: dispatchAllowlist, unknown: true}]) {
    assert.throws(() => withoutSourceDispatchConfig({...config, features: {...config.features, tool_registry: registry}}), /allowlist mismatch/);
  }
});
