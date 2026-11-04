import test from 'node:test';
import assert from 'node:assert/strict';
import {smokeOptions, smokeDefault} from './fixtures/provider-authenticated-smoke.mjs';

test('live smoke requires explicit default selection and one-turn consent', () => {
  const args = ['--account-root', '/private/profile', '--binary', '/private/codex',
    '--use-advertised-default', '--run-one-turn'];
  assert.deepEqual(smokeOptions(args), {root: '/private/profile', binary: '/private/codex'});
  assert.equal(smokeOptions([...args, '--code-mode-candidate']).codeMode, true);
  assert.deepEqual(smokeOptions([...args, '--code-mode-candidate', '--approval-once']),
    {root: '/private/profile', binary: '/private/codex', codeMode: true, approvalOnce: true});
  assert.deepEqual(smokeOptions([...args, '--code-mode-candidate', '--host-gateway']),
    {root: '/private/profile', binary: '/private/codex', codeMode: true, hostGateway: true});
  assert.deepEqual(smokeOptions([...args, '--code-mode-candidate', '--host-gateway', '--source-dispatch']),
    {root: '/private/profile', binary: '/private/codex', codeMode: true, hostGateway: true, sourceDispatch: true});
  assert.throws(() => smokeOptions([...args, '--source-dispatch']));
  assert.throws(() => smokeOptions([...args, '--code-mode-candidate', '--source-dispatch']));
  assert.throws(() => smokeOptions([...args, '--code-mode-candidate', '--approval-once', '--source-dispatch']));
  assert.throws(() => smokeOptions([...args, '--host-gateway']));
  assert.throws(() => smokeOptions([...args, '--code-mode-candidate', '--host-gateway', '--approval-once']));
  assert.throws(() => smokeOptions([...args, '--approval-once']));
  assert.throws(() => smokeOptions([...args, '--approval-once', '--code-mode-candidate']));
  assert.throws(() => smokeOptions([]));
  assert.throws(() => smokeOptions(args.slice(0, -1)));
  assert.throws(() => smokeOptions([...args, '--extra']));
  assert.throws(() => smokeOptions(args.map(a => a === '/private/profile' ? 'relative' : a)));
});

test('default selection requires exactly one advertised default with no fallback', () => {
  assert.equal(smokeDefault([{model: 'other', isDefault: false}, {model: 'chosen', isDefault: true}]), 'chosen');
  assert.throws(() => smokeDefault([]));
  assert.throws(() => smokeDefault([{model: 'other', isDefault: false}]));
  assert.throws(() => smokeDefault([{model: 'a', isDefault: true}, {model: 'b', isDefault: true}]));
});
