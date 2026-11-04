import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ownedCodeModeGateway, codeModeHostSha256, closeOwnedCodeModeResources} from '../server/owned-code-mode-gateway.mjs';

test('Code Mode fixture imports resolve to runtime-owned implementation and exact protocol', async () => {
  const runtime = await import('../server/code-mode-gateway.mjs');
  const fixture = await import('./fixtures/code-mode-gateway.mjs');
  const ownedFixture = await import('./fixtures/owned-code-mode-gateway.mjs');
  assert.equal(fixture.startCodeModeGateway, runtime.startCodeModeGateway);
  assert.equal(ownedFixture.ownedCodeModeGateway, ownedCodeModeGateway);
  assert.equal(codeModeHostSha256, 'fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b');
  for (const name of ['codex.code_mode.v1.proto', 'LICENSE', 'NOTICE']) {
    const shipped = await readFile(new URL(`../server/vendor/code-mode-protocol/${name}`, import.meta.url));
    const historical = await readFile(new URL(`./fixtures/code-mode-protocol/${name}`, import.meta.url));
    assert.deepEqual(shipped, historical);
    if (name.endsWith('.proto')) assert.equal(createHash('sha256').update(shipped).digest('hex'),
      '406d8f47d8d0b95a9d4ae104890e5e52764c9597e9271f75ff434a4ce24748d0');
  }
});

test('owned Code Mode host refuses an unpinned executable before spawn', async () => {
  await assert.rejects(ownedCodeModeGateway({binary: process.execPath, cwd: process.cwd(), env: {}}),
    error => error.code === 'ERR_ASSERTION');
});

test('gateway cleanup failure still waits for owned host exit before rejecting', async () => {
  const failure = Error('gateway cleanup failure');
  let resolveExited, linesClosed = false;
  const exited = new Promise(resolve => {resolveExited = resolve;});
  const signals = [];
  const child = {exitCode: null, signalCode: null, kill(signal) {signals.push(signal);}};
  const closing = closeOwnedCodeModeResources({gateway: {async close() {throw failure;}}, child, exited,
    lines: {close() {linesClosed = true;}}});
  let settled = false;
  const outcome = closing.then(() => {settled = true;}, error => {settled = true; return error;});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(settled, false);
  assert.equal(linesClosed, false);
  child.signalCode = 'SIGTERM'; resolveExited({code: null, signal: 'SIGTERM'});
  assert.equal(await outcome, failure);
  assert.equal(linesClosed, true);
});

test('owned Code Mode cleanup escalates an unresponsive host to SIGKILL', async () => {
  let resolveExited, linesClosed = false;
  const exited = new Promise(resolve => {resolveExited = resolve;});
  const signals = [];
  const child = {exitCode: null, signalCode: null, kill(signal) {
    signals.push(signal);
    if (signal === 'SIGKILL') {this.signalCode = signal; resolveExited({code: null, signal});}
  }};
  // Keep the test event loop alive; the production escalation timer is unref'ed.
  const guard = setTimeout(() => resolveExited({timeout: true}), 4000);
  try {
    await closeOwnedCodeModeResources({child, exited, lines: {close() {linesClosed = true;}}});
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    assert.equal(linesClosed, true);
  } finally {clearTimeout(guard);}
});
