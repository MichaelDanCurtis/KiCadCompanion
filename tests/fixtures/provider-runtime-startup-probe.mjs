// Explicit, credential-free real-server startup qualification. Never signs in,
// selects a real project, starts a model turn or connects a native application.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readdir, lstat, writeFile, readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertProbeBinary, probeQualification, sha256} from '../../server/provider-isolation.mjs';
import {sourceDispatchLaunch, sourceDispatchCandidate} from '../../server/provider-dispatch.mjs';

assert.deepEqual(process.argv.slice(2), ['--run'], 'Run this explicit probe with --run only');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const binary = '/Applications/ChatGPT.app/Contents/Resources/codex';
assertProbeBinary(probeQualification.version, await readFile(binary));
await sourceDispatchLaunch(); // Verify the fixed patched executable without spawning it.
const root = await mkdtemp(join(tmpdir(), 'benchline-runtime-startup-'));
const stateRoot = join(root, 'state'), home = join(root, 'home');
await mkdir(home, {mode: 0o700});
const receiptPath = join(root, 'receipt.json');
const receipt = {schemaVersion: 1, startedAt: new Date().toISOString(), pass: false,
  probe: 'actual-server-opted-in-runtime-startup', model: 'explicit-test-model',
  binaries: {installedSha256: probeQualification.binarySha256, sourceSha256: sourceDispatchCandidate.binarySha256},
  statuses: {}, limitations: ['Startup and rejected selection only; no account preparation, sign-in, model turn or CAD connection.',
    'Legacy no-board guard returns 400 before the separately tested 422 provider-mode refusal.']};
const reserved = createServer();
reserved.listen(0, '127.0.0.1'); await once(reserved, 'listening');
const port = reserved.address().port;
await new Promise(resolve => reserved.close(resolve));
// An allowlist, not a filtered copy: no account/provider, proxy, library-loader,
// customer workspace or native connection environment is inherited.
const env = {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: root, LANG: 'en_US.UTF-8',
  BENCHLINE_PORT: String(port), BENCHLINE_STATE_DIR: stateRoot, BENCHLINE_AUTOCONNECT: '0',
  BENCHLINE_PROVIDER_RUNTIME: 'local-dispatch-v1', BENCHLINE_PROVIDER_MODEL: 'explicit-test-model',
  CODEX_BIN: binary, KONNECT_BIN: '/does-not-exist', KICAD_CLI: '/does-not-exist',
  KICAD_PYTHON: '/does-not-exist', BENCHLINE_PYTHON: '/does-not-exist',
  COMPANION_KICAD_CONFIG_DIR: join(root, 'empty-kicad-config')};
const child = spawn(process.execPath, ['server/index.mjs'], {cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe']});
const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({code, signal})));
let stdoutBytes = 0, stderrBytes = 0, spawnFailed = false;
child.stdout.on('data', bytes => {stdoutBytes += bytes.length;});
child.stderr.on('data', bytes => {stderrBytes += bytes.length;});
child.on('error', () => {spawnFailed = true;});
const url = `http://127.0.0.1:${port}`;
const request = (path, body) => fetch(url + path, {signal: AbortSignal.timeout(5000),
  ...(body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})});
const record = async (name, path, body, expected) => {
  const response = await request(path, body); receipt.statuses[name] = response.status;
  assert.equal(response.status, expected, name); return response;
};
const profileAbsent = async () => {
  await assert.rejects(lstat(join(stateRoot, 'providers')), error => error.code === 'ENOENT');
  assert.deepEqual(await readdir(home), []);
};
let failure;
try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) break;
    try {if ((await request('/api/state')).ok) {ready = true; break;}} catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'Actual server did not become ready');
  const state = await (await record('state', '/api/state', undefined, 200)).json();
  assert.equal(state.projectSelected, false); assert.equal(state.projectKey, 'unconfigured');
  assert.equal(state.board, null); assert.equal(state.agent.connected, false);
  for (const field of ['projects', 'messages', 'permissions', 'requests']) assert.deepEqual(state[field], []);
  assert.equal(state.providerBoundary.modes.discuss.supported, false);
  assert.equal(state.providerBoundary.modes.agent.supported, false);
  const capabilityResponse = await record('capabilities', '/api/provider/product/capabilities', undefined, 200);
  assert.equal(capabilityResponse.headers.get('cache-control'), 'no-store');
  const capabilities = await capabilityResponse.json();
  assert.equal(capabilities.modes.discuss.supported, true);
  assert.equal(capabilities.modes.agent.supported, true);
  receipt.productCapabilities = {discuss: true, agent: true};
  const accountResponse = await record('account', '/api/provider/account', undefined, 200);
  assert.equal(accountResponse.headers.get('cache-control'), 'no-store');
  const inertAccount = {phase: 'disconnected', signedIn: null, authType: null,
    modelExecutionEnabled: false, busy: false, loginPending: false};
  assert.deepEqual(await accountResponse.json(), inertAccount);
  assert.deepEqual(await (await request('/api/provider/product')).json(), {selectionId: null, scope: null, phase: 'disconnected'});
  await profileAbsent();
  await record('legacyConnect', '/api/connect', {}, 400);
  await record('legacyChat', '/api/chat', {text: 'Do not launch', mode: 'agent'}, 400);
  await record('absentAgentConnect', '/api/agent/connect', {}, 404);
  await record('absentAgentMessage', '/api/agent/message', {text: 'Do not launch'}, 404);
  const scope = {projectId: '00000000-0000-4000-8000-000000000001',
    documentIds: ['00000000-0000-4000-8000-000000000002'], mode: 'discuss',
    expectedManifestHash: 'synthetic', expectedEpoch: '00000000-0000-4000-8000-000000000003'};
  await record('malformedSelection', '/api/provider/product/select', {...scope, cwd: '/untrusted'}, 400);
  await record('unknownMode', '/api/provider/product/select', {...scope, mode: 'unknown'}, 400);
  await record('unknownProject', '/api/provider/product/select', scope, 503);
  const provider = await (await request('/api/provider/product')).json();
  assert.deepEqual(provider, {selectionId: null, scope: null, phase: 'error'});
  assert.deepEqual(await (await request('/api/provider/account')).json(), inertAccount);
  await profileAbsent();
  receipt.accountInert = true; receipt.noProfileOrCredentialsCreated = true;
  receipt.noSelectionActivated = true; receipt.legacyBoundaryDisabled = true;
  receipt.pass = true;
} catch (error) {failure = error; receipt.failure = 'Startup qualification assertion failed';}
finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 3000);
  killTimer.unref();
  receipt.shutdown = await exited; clearTimeout(killTimer);
  receipt.outputBytes = {stdout: stdoutBytes, stderr: stderrBytes};
  if (receipt.shutdown.code !== 0 || receipt.shutdown.signal !== null) receipt.pass = false;
  receipt.finishedAt = new Date().toISOString();
  receipt.probeSha256 = sha256(await readFile(fileURLToPath(import.meta.url)));
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({receipt: receiptPath, ...receipt}, null, 2));
}
if (failure) throw failure;
assert.equal(receipt.pass, true, 'Actual server did not shut down cleanly');
