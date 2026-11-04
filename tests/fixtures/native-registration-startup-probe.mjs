// Explicit disposable, read-only native registration/startup qualification.
// Preview observes selected model lists; never call apply, execute, save or undo.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, lstat, readdir} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {createKonnectModelRegistration, konnectModelRegistrationSchema} from '../../server/adapters/konnect-model-registration.mjs';
import {assertProbeBinary, probeQualification} from '../../server/provider-isolation.mjs';
import {sourceDispatchLaunch} from '../../server/provider-dispatch.mjs';

assert.deepEqual(process.argv.slice(2), ['--run'], 'Run this read-only disposable probe with --run only');
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const configurationPath = join(appRoot, '.runtime/native-model-registration-current.json');
const configuration = konnectModelRegistrationSchema.parse(JSON.parse(await readFile(configurationPath, 'utf8')));
const installedCodex = '/Applications/ChatGPT.app/Contents/Resources/codex';
assertProbeBinary(probeQualification.version, await readFile(installedCodex));
await sourceDispatchLaunch();
const q = configuration.qualification;
assert.match(q.board, /^\/private\/tmp\/benchline-native-live\.[^/]+\/fixtures\/BenchlineNativeTest\.kicad_pcb$/);
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(await readFile(q.board)), q.savedSha256);
const root = await mkdtemp(join(tmpdir(), 'benchline-native-registration-startup-'));
const stateRoot = join(root, 'state'), home = join(root, 'home');
await mkdir(home, {mode: 0o700});
const receiptPath = join(root, 'receipt.json');
const receipt = {schemaVersion: 1, startedAt: new Date().toISOString(), passed: false,
  nativeInstance: q.nativeInstance, savedSha256: q.savedSha256, applyCalls: 0,
  configurationSha256: sha(await readFile(configurationPath)), ownedMcpProcessesClosed: 0,
  limitations: ['Read-only registration and startup only; no model assignment, save, customer scope or provider/account call.',
    'Selected footprint model-list snapshots and live revision are compared; this is not a new mutation/preservation qualification.']};
const run = promisify(execFile);
async function childrenOf(pid) {
  try {
    const {stdout} = await run('/usr/bin/pgrep', ['-P', String(pid)], {encoding: 'utf8'});
    return stdout.trim().split(/\s+/).filter(Boolean).map(Number);
  } catch (error) {if (error.code === 1) return []; throw error;}
}
function alive(pid) {try {process.kill(pid, 0); return true;} catch (error) {if (error.code === 'ESRCH') return false; throw error;}}
async function assertExited(pids) {
  for (let attempt = 0; attempt < 100 && pids.some(alive); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(pids.every(pid => !alive(pid)), 'Owned MCP process survived cleanup');
  receipt.ownedMcpProcessesClosed += pids.length;
}
const target = {path: q.board};
const input = {projectId: randomUUID(), documentId: randomUUID(), operation: 'set-placed-models',
  args: {replacements: q.footprints.map(footprint => ({footprint, models: []}))}};
async function readSnapshot() {
  const existing = new Set(await childrenOf(process.pid));
  let registration, owned = [];
  try {
    registration = await createKonnectModelRegistration(configuration);
    owned = (await childrenOf(process.pid)).filter(pid => !existing.has(pid));
    assert.equal(registration.status().supported, true, 'Private native registration unsupported');
    assert.equal(owned.length, 1, 'Expected one owned Konnect MCP process');
    const first = (await registration.adapter.snapshot(target, input)).snapshot;
    const second = (await registration.adapter.snapshot(target, input)).snapshot;
    assert.equal(first.revision, second.revision, 'Read-only native revision must remain stable');
    assert.deepEqual(first.before, second.before, 'Read-only selected model lists must remain stable');
    assert.ok(first.before.every(item => item.models.length === 0), 'Disposable baseline must have empty selected model lists');
    assert.equal(sha(await readFile(q.board)), q.savedSha256);
    return {revision: first.revision, models: first.before};
  } finally {
    await registration?.close();
    await assertExited(owned);
  }
}
let child, exited, serverMcp = [], failure, stdoutBytes = 0, stderrBytes = 0;
try {
  const old = konnectModelRegistrationSchema.parse(JSON.parse(await readFile(join(appRoot, '.runtime/native-model-registration.json'), 'utf8')));
  assert.notEqual(old.qualification.nativeInstance, q.nativeInstance);
  const initialChildren = await childrenOf(process.pid);
  const staleRegistration = await createKonnectModelRegistration(old);
  try {
    assert.equal(staleRegistration.status().supported, false);
    assert.equal(staleRegistration.adapter.capabilities()[0].supported, false);
  } finally {await staleRegistration.close();}
  assert.deepEqual(await childrenOf(process.pid), initialChildren, 'Old native binding leaked an MCP process');
  receipt.oldBindingRefusedWithoutRebinding = true;
  receipt.oldBindingCleanupVerified = true;
  const before = await readSnapshot();
  receipt.before = {revision: before.revision, selectedFootprints: before.models.length, selectedModelCount: 0};
  const reserved = createServer(); reserved.listen(0, '127.0.0.1'); await once(reserved, 'listening');
  const port = reserved.address().port; await new Promise(resolve => reserved.close(resolve));
  const env = {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: root, LANG: 'en_US.UTF-8',
    BENCHLINE_PORT: String(port), BENCHLINE_STATE_DIR: stateRoot, BENCHLINE_AUTOCONNECT: '0',
    BENCHLINE_NATIVE_MODEL_REGISTRATION: configurationPath,
    BENCHLINE_PROVIDER_RUNTIME: 'local-dispatch-v1', BENCHLINE_PROVIDER_MODEL: 'explicit-test-model',
    CODEX_BIN: installedCodex, KONNECT_BIN: '/does-not-exist', KICAD_CLI: '/does-not-exist',
    KICAD_PYTHON: '/does-not-exist', BENCHLINE_PYTHON: '/does-not-exist',
    COMPANION_KICAD_CONFIG_DIR: join(root, 'empty-kicad-config')};
  child = spawn(process.execPath, ['server/index.mjs'], {cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe']});
  exited = new Promise(resolve => child.once('close', (code, signal) => resolve({code, signal})));
  let spawnFailed = false; child.on('error', () => {spawnFailed = true;});
  child.stdout.on('data', bytes => {stdoutBytes += bytes.length;});
  child.stderr.on('data', bytes => {stderrBytes += bytes.length;});
  const url = `http://127.0.0.1:${port}`;
  const get = path => fetch(url + path, {signal: AbortSignal.timeout(5000)});
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) break;
    try {if ((await get('/api/state')).ok) {ready = true; break;}} catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'Actual server did not become ready');
  serverMcp = await childrenOf(child.pid);
  assert.equal(serverMcp.length, 1, 'Actual server must own only its registered native MCP process');
  const capabilities = await (await get('/api/actions/capabilities')).json();
  const models = capabilities.adapters.find(adapter => adapter.name === 'native-models');
  assert.deepEqual(models.operations, [{operation: 'set-placed-models', version: 1, effect: 'write', supported: true}]);
  const legacy = capabilities.adapters.find(adapter => adapter.name === 'konnect');
  assert.equal(legacy.operations.find(operation => operation.operation === 'refresh-footprints').supported, false);
  receipt.nativeModelCapabilitySupported = true; receipt.legacyFootprintMutationUnsupported = true;
  const providerCapabilities = await (await get('/api/provider/product/capabilities')).json();
  assert.equal(providerCapabilities.modes.discuss.supported, true);
  assert.equal(providerCapabilities.modes.agent.supported, true);
  receipt.productProviderCapabilitySupported = true;
  const state = await (await get('/api/state')).json();
  assert.equal(state.projectSelected, false); assert.equal(state.board, null); assert.equal(state.agent.connected, false);
  assert.equal(state.providerBoundary.modes.agent.supported, false);
  for (const key of ['projects', 'messages', 'permissions', 'requests']) assert.deepEqual(state[key], []);
  await assert.rejects(lstat(join(stateRoot, 'providers')), error => error.code === 'ENOENT');
  const homeEntries = [];
  async function inspectHome(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      homeEntries.push(relative(home, path));
      if (entry.isDirectory()) await inspectHome(path);
    }
  }
  await inspectHome(home);
  assert.deepEqual(homeEntries.sort(), ['Library', 'Library/Application Support', 'Library/Application Support/konnect',
    'Library/Application Support/konnect/logs', 'Library/Application Support/konnect/logs/calls.jsonl']);
  receipt.privateHomeContainsOnlyKonnectLog = true;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');}, 5000);
  timer.unref(); receipt.shutdown = await exited; clearTimeout(timer);
  assert.deepEqual(receipt.shutdown, {code: 0, signal: null});
  await assertExited(serverMcp); serverMcp = [];
  const after = await readSnapshot();
  assert.deepEqual(after, before, 'Registered actual-server startup changed live native revision or models');
  assert.equal(sha(await readFile(q.board)), q.savedSha256);
  receipt.after = {revision: after.revision, selectedFootprints: after.models.length, selectedModelCount: 0};
  receipt.savedBoardUnchanged = true; receipt.liveSnapshotUnchanged = true;
  receipt.noProviderProfileCreated = true; receipt.passed = true;
} catch (error) {failure = error; receipt.failure = 'Read-only native startup qualification failed';}
finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (exited) {
    const timer = setTimeout(() => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');}, 5000);
    timer.unref(); receipt.shutdown = await exited; clearTimeout(timer);
  }
  if (serverMcp.length) {try {await assertExited(serverMcp);} catch {receipt.passed = false; receipt.cleanupFailure = true;}}
  receipt.outputBytes = {stdout: stdoutBytes, stderr: stderrBytes};
  receipt.finishedAt = new Date().toISOString();
  receipt.probeSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({receipt: receiptPath, ...receipt}, null, 2));
}
if (failure) throw failure;
assert.equal(receipt.passed, true);
