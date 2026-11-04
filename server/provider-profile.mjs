import {readFile, writeFile, mkdir, mkdtemp, lstat, realpath, readdir, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, parse} from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CodexAgent} from './codex.mjs';
import {sha256, probeQualification, assertProbeBinary, parseProbeFeatures, probeEnvironment, assertIsolatedCommonConfig} from './provider-isolation.mjs';
import {sourceDispatchLaunch, withoutSourceDispatchConfig, assertSourceDispatchBinary} from './provider-dispatch.mjs';

const check = (value, message) => {if (!value) throw Error(message);};
// Candidate experiment only; never enabled by the production controller.
export const codeModeCandidate = Object.freeze({
  hostSha256: 'fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b',
  features: Object.freeze(['code_mode', 'code_mode_host', 'code_mode_only']),
  productionEnabled: false,
});
// Account setup is distinct from qualified model execution. There is deliberately
// no selected model, no thread creation, and no imported API key/external tokens.
export function accountSetupConfiguration(features) {
  check(sha256(JSON.stringify([...features].sort())) === probeQualification.featureNamesSha256, 'Unqualified feature inventory');
  return ['model_provider="openai"', 'forced_login_method="chatgpt"', 'chatgpt_base_url="https://chatgpt.com/backend-api/"',
    'approval_policy="never"', 'sandbox_mode="read-only"', 'web_search="disabled"',
    'project_doc_max_bytes=0', 'cli_auth_credentials_store="file"', 'allow_login_shell=false',
    'mcp_servers={}', 'plugins={}', 'history.persistence="none"', 'analytics.enabled=false', 'feedback.enabled=false',
    '[features]', ...features.map(name => `${name}=${name === 'skip_host_skill_discovery'}`), ''].join('\n');
}
export function assertAccountSetupConfig(config, features) {
  assertIsolatedCommonConfig(config, features);
  check(config.model_provider === 'openai' && config.model == null && config.forced_login_method === 'chatgpt', 'Unexpected account setup provider');
  check(config.model_providers && Object.keys(config.model_providers).length === 0, 'Unexpected custom provider');
  check(config.chatgpt_base_url === 'https://chatgpt.com/backend-api/', 'Unexpected ChatGPT endpoint');
  for (const key of ['openai_base_url', 'experimental_realtime_ws_base_url']) check(config[key] == null, 'Unexpected auth/provider endpoint');
  check(config.analytics?.enabled === false && config.feedback?.enabled === false, 'Unexpected profile telemetry');
  return {configurationMatches: true, modelExecutionEnabled: false};
}

export function assertCandidateCodeModeConfig(config, features) {
  const baseline = structuredClone(config);
  for (const feature of codeModeCandidate.features) {
    check(features.includes(feature) && config.features?.[feature] === true, 'Candidate Code Mode feature mismatch');
    baseline.features[feature] = false;
  }
  // Only the three explicitly verified deltas differ. Every original account,
  // endpoint, inheritance, permission and remaining feature check still applies.
  assertAccountSetupConfig(baseline, features);
  return {configurationMatches: true, candidateCodeMode: true, productionEnabled: false};
}

async function noSymlinks(path) {
  const absolute = resolve(path), base = parse(absolute).root;
  let current = base;
  for (const part of absolute.slice(base.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try {check(!(await lstat(current)).isSymbolicLink(), 'Provider profile path contains a symlink');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return absolute;
}
async function privateDirectory(path) {
  await noSymlinks(path);
  try {await mkdir(path, {mode: 0o700});} catch (error) {if (error.code !== 'EEXIST') throw error;}
  const info = await lstat(path);
  check(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0, 'Provider profile directory must be private');
  if (process.getuid) check(info.uid === process.getuid(), 'Provider profile has another owner');
}
async function privateFile(path, expected) {
  const info = await lstat(path);
  check(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 && info.size <= 256 * 1024, 'Unexpected provider profile file');
  if (process.getuid) check(info.uid === process.getuid(), 'Provider profile file has another owner');
  check(await readFile(path, 'utf8') === expected, 'Provider profile changed; inspect it instead of overwriting');
}

// The host chooses root under its own private state directory, never under a
// customer project. Existing/partial/unowned content is preserved and refused.
export async function prepareAccountProfile({root, features}) {
  check(resolve(root) === root && root !== parse(root).root, 'Provider profile root must be a dedicated absolute directory');
  await noSymlinks(root);
  const parent = dirname(root); await mkdir(parent, {recursive: true, mode: 0o700});
  const configuration = accountSetupConfiguration(features);
  const owner = JSON.stringify({schemaVersion: 1, product: 'benchline', purpose: 'isolated-codex-account',
    configSha256: sha256(configuration), binarySha256: probeQualification.binarySha256}) + '\n';
  let created = false;
  try {await mkdir(root, {mode: 0o700}); created = true;} catch (error) {if (error.code !== 'EEXIST') throw error;}
  await privateDirectory(root);
  if (created) {
    await privateDirectory(join(root, 'codex')); await privateDirectory(join(root, 'workspace'));
    await writeFile(join(root, 'codex/config.toml'), configuration, {mode: 0o600, flag: 'wx'});
    // Marker is last: interrupted initialization is refused, never adopted.
    await writeFile(join(root, 'owner.json'), owner, {mode: 0o600, flag: 'wx'});
  }
  await privateFile(join(root, 'owner.json'), owner);
  await privateDirectory(join(root, 'codex')); await privateDirectory(join(root, 'workspace'));
  await privateFile(join(root, 'codex/config.toml'), configuration);
  // Check metadata only. A substituted auth-file symlink must never make Codex
  // read an existing global credential file through this isolated profile.
  try {
    const auth = await lstat(join(root, 'codex/auth.json'));
    check(auth.isFile() && !auth.isSymbolicLink() && (auth.mode & 0o077) === 0, 'Unexpected auth file metadata');
    if (process.getuid) check(auth.uid === process.getuid(), 'Auth file has another owner');
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  check((await readdir(join(root, 'workspace'))).length === 0, 'Account setup workspace must remain empty');
  return {root, cwd: join(root, 'workspace'), env: probeEnvironment(root), configuration};
}

export async function claimAccountProfile(root) {
  const path = join(root, 'account-process.lock');
  const owner = JSON.stringify({schemaVersion: 1, pid: process.pid, nonce: randomUUID()}) + '\n';
  try {await writeFile(path, owner, {flag: 'wx', mode: 0o600});}
  catch (error) {if (error.code === 'EEXIST') throw Error('Account profile is in use or requires stale-lock inspection'); throw error;}
  let released = false;
  return async () => {
    if (released) return;
    await privateFile(path, owner); await unlink(path); released = true;
  };
}

/** Explicit host account setup only; no automatic login, model call or public RPC.
 * No auth.json bytes are read by Benchline. Codex manages only this new profile.
 */
async function openProfileTransport({binary, root, onEvent, onStatus, signal, accountOnly, candidateCodeMode = false,
  candidateSourceDispatch = false, candidateHostFactory}) {
  check(!candidateHostFactory || (candidateCodeMode && !accountOnly && typeof candidateHostFactory === 'function'),
    'Only an explicit Code Mode candidate may supply a test host');
  check(!candidateSourceDispatch || (candidateCodeMode && !accountOnly && typeof candidateHostFactory === 'function'),
    'Source dispatcher qualification requires the owned candidate gateway');
  signal?.throwIfAborted();
  const bytes = await readFile(binary); assertProbeBinary(probeQualification.version, bytes);
  // Never discover against a possibly unowned pre-existing profile. Discovery
  // gets its own empty disposable profile, without copying global configuration.
  const discovery = await realpath(await mkdtemp(join(tmpdir(), 'benchline-codex-discovery-')));
  await mkdir(join(discovery, 'codex'), {mode: 0o700});
  const env = probeEnvironment(discovery), exec = promisify(execFile);
  assertProbeBinary((await exec(binary, ['--version'], {env, signal})).stdout, bytes);
  const features = parseProbeFeatures((await exec(binary, ['features', 'list'], {env, signal})).stdout);
  const launch = candidateSourceDispatch ? await sourceDispatchLaunch() : {binary, prefix: ['app-server'], overrides: []};
  if (candidateSourceDispatch) {
    assertSourceDispatchBinary((await exec(launch.binary, ['--version'], {env, signal})).stdout, await readFile(launch.binary));
  }
  if (candidateCodeMode) {
    check(!accountOnly, 'Code Mode is not an account-setup feature');
    check(sha256(await readFile(join(dirname(binary), 'codex-code-mode-host'))) === codeModeCandidate.hostSha256,
      'Code Mode host changed; requalification required');
  }
  const profile = await prepareAccountProfile({root, features});
  signal?.throwIfAborted();
  const release = await claimAccountProfile(root);
  let candidateHost;
  try {
    if (candidateHostFactory) {
      candidateHost = await candidateHostFactory({binary: join(dirname(binary), 'codex-code-mode-host'), cwd: profile.cwd, env: profile.env});
      const url = new URL(candidateHost.url);
      check(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port && url.pathname === '/' &&
        !url.username && !url.password && !url.search && !url.hash && typeof candidateHost.close === 'function',
      'Candidate test host must be owned and loopback-only');
      check(!candidateSourceDispatch || candidateHost.closed instanceof Promise,
        'Source dispatcher requires observable host termination');
      signal?.throwIfAborted();
    }
  } catch (error) {
    try {await candidateHost?.close?.();} finally {await release();}
    throw error;
  }
  const rpc = new CodexAgent({onEvent, onStatus, accountOnly});
  const overrides = candidateCodeMode ? codeModeCandidate.features.flatMap(name => ['-c', `features.${name}=true`]) : [];
  const hostArgs = candidateHost ? ['--code-mode-host', candidateHost.url] : [];
  const child = spawn(launch.binary, [...overrides, ...launch.overrides, ...launch.prefix, '--strict-config', '--listen', 'stdio://', ...hostArgs],
    {cwd: profile.cwd, env: profile.env, stdio: ['pipe', 'pipe', 'pipe']});
  const exited = new Promise(resolve => child.once('close', resolve));
  const close = rpc.close.bind(rpc); let closing;
  const abort = () => rpc.close().catch(() => {});
  rpc.close = () => closing ||= (async () => {
    signal?.removeEventListener('abort', abort);
    try {await close();}
    finally {
      // A failed session/journal cleanup must not release ownership while the
      // dispatcher is still terminating. Preserve the failure after shutdown.
      try {await exited;}
      finally {try {await candidateHost?.close();} finally {await release();}}
    }
  })();
  rpc.attach(child);
  // Losing the execution host invalidates the whole candidate, even when idle.
  // Do not leave an apparently ready provider or its exclusive profile lock alive.
  candidateHost?.closed?.then(() => {if (!closing) rpc.fail();}, () => rpc.fail());
  signal?.addEventListener('abort', abort, {once: true});
  try {
    signal?.throwIfAborted();
    const info = await rpc.request('initialize', {clientInfo: {name: 'benchline', version: '0.1.0'},
      ...(accountOnly ? {} : {capabilities: {experimentalApi: true}})});
    check(await realpath(info.codexHome) === await realpath(join(root, 'codex')), 'Wrong provider profile');
    rpc.send({method: 'initialized'});
    const effective = await rpc.request('config/read', {includeLayers: false, cwd: profile.cwd});
    if (candidateCodeMode) assertCandidateCodeModeConfig(candidateSourceDispatch ? withoutSourceDispatchConfig(effective.config) : effective.config, features);
    else assertAccountSetupConfig(effective.config, features);
    signal?.throwIfAborted();
    return {rpc, cwd: profile.cwd};
  } catch (error) {await rpc.close(); throw error;}
}

export async function openAccountTransport(options) {
  return (await openProfileTransport({...options, accountOnly: true, candidateCodeMode: false, candidateSourceDispatch: false})).rpc;
}

// Candidate launcher, not production qualification. No controller uses this
// until authenticated/model/native evidence qualifies the supported mode.
export async function openCandidateModelProfile(options) {
  return openProfileTransport({...options, accountOnly: false, candidateCodeMode: false, candidateSourceDispatch: false});
}

export async function openCandidateCodeModeProfile(options) {
  return openProfileTransport({...options, accountOnly: false, candidateCodeMode: true, candidateSourceDispatch: false});
}

// An explicit private test path: same owned profile and lock, unchanged on-disk
// configuration, exact patched executable plus the independently pinned host.
export async function openCandidateSourceDispatchProfile(options) {
  return openProfileTransport({...options, accountOnly: false, candidateCodeMode: true, candidateSourceDispatch: true});
}
