import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, readFile, writeFile, mkdir, symlink, chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ProviderAccount, managedLogin} from '../server/provider-account.mjs';
import {prepareAccountProfile, accountSetupConfiguration, assertAccountSetupConfig, claimAccountProfile,
  assertCandidateCodeModeConfig, codeModeCandidate, openAccountTransport, openCandidateModelProfile} from '../server/provider-profile.mjs';
import {probeQualification, sha256} from '../server/provider-isolation.mjs';
import {CodexAgent} from '../server/codex.mjs';
const features = JSON.parse(await readFile(new URL('./fixtures/codex-features-0.153.4.json', import.meta.url), 'utf8'));
const temp = async () => join(await realpath(await mkdtemp(join(tmpdir(), 'benchline-account-test-'))), 'profile');
const latch = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
test('test host factory cannot be supplied to account setup or ordinary model profile', async () => {
  let called = false;
  for (const open of [openAccountTransport, openCandidateModelProfile]) {
    await assert.rejects(open({binary: '/must-not-open', root: '/must-not-open',
      candidateHostFactory: async () => {called = true;}}), /Only an explicit Code Mode candidate/);
  }
  assert.equal(called, false);
});
function fixture() {
  let callbacks, account = null, hook, closed = 0;
  const calls = [], login = {type: 'chatgpt', loginId: randomUUID(), authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic'};
  const rpc = {close: async () => {closed++;}, request: async (method, params) => {
    calls.push({method, params}); if (hook) {const value = await hook(method, params); if (value !== undefined) return value;}
    if (method === 'account/read') return {account, requiresOpenaiAuth: true};
    if (method === 'account/login/start') return login;
    if (method === 'account/logout') account = null;
    return {};
  }};
  const manager = new ProviderAccount({binary: '/unused', root: '/unused', open: async value => {callbacks = value; return rpc;}});
  return {manager, calls, login, rpc, closed: () => closed, emit: event => callbacks.onEvent(event),
    account: value => account = value, hook: value => hook = value};
}
test('account config uses the pinned inventory and does not enable model execution', () => {
  assert.equal(sha256(JSON.stringify(features)), probeQualification.featureNamesSha256);
  const text = accountSetupConfiguration(features);
  assert.match(text, /forced_login_method="chatgpt"/); assert.doesNotMatch(text, /^model=/m);
  assert.match(text, /shell_tool=false/); assert.match(text, /skip_host_skill_discovery=true/);
  assert.throws(() => accountSetupConfiguration([...features, 'unexpected']), /Unqualified/);
});
test('owned profile is repeatable without replacing local auth bytes or importing credentials', async () => {
  const root = await temp(), first = await prepareAccountProfile({root, features});
  const auth = join(root, 'codex/auth.json'); await writeFile(auth, 'synthetic private credential', {mode: 0o600});
  const second = await prepareAccountProfile({root, features});
  assert.equal(second.configuration, first.configuration); assert.equal(await readFile(auth, 'utf8'), 'synthetic private credential');
  assert.equal(second.env.CODEX_HOME, join(root, 'codex')); assert.equal(second.env.OPENAI_API_KEY, undefined);
});
test('unowned or altered profiles are preserved and refused', async () => {
  const root = await temp(); await mkdir(root, {mode: 0o700}); await writeFile(join(root, 'existing.txt'), 'keep');
  await assert.rejects(prepareAccountProfile({root, features})); assert.equal(await readFile(join(root, 'existing.txt'), 'utf8'), 'keep');
  const owned = await temp(); await prepareAccountProfile({root: owned, features});
  const path = join(owned, 'codex/config.toml'); await writeFile(path, 'altered');
  await assert.rejects(prepareAccountProfile({root: owned, features}), /changed/); assert.equal(await readFile(path, 'utf8'), 'altered');
});
test('symlinks and non-private profile/auth permissions are rejected', async () => {
  const root = await temp(); await prepareAccountProfile({root, features});
  const synthetic = join(root, 'fake-external-auth'); await writeFile(synthetic, 'keep');
  await symlink(synthetic, join(root, 'codex/auth.json'));
  await assert.rejects(prepareAccountProfile({root, features}), /auth file/);
  const other = await temp(); await prepareAccountProfile({root: other, features}); await chmod(other, 0o755);
  await assert.rejects(prepareAccountProfile({root: other, features}), /private/);
});
test('effective account configuration rejects custom endpoints/providers and enabled tools', () => {
  const config = {model_provider: 'openai', forced_login_method: 'chatgpt', model: null, model_providers: {},
    chatgpt_base_url: 'https://chatgpt.com/backend-api/', approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled',
    features: Object.fromEntries(features.filter(n => n !== 'apps_mcp_path_override').map(n => [n, n === 'skip_host_skill_discovery'])),
    mcp_servers: {}, plugins: {}, marketplaces: {}, project_doc_max_bytes: 0, cli_auth_credentials_store: 'file',
    allow_login_shell: false, history: {persistence: 'none'}, analytics: {enabled: false}, feedback: {enabled: false}};
  assert.equal(assertAccountSetupConfig(config, features).modelExecutionEnabled, false);
  for (const change of [{chatgpt_base_url: 'https://attacker.example/'}, {openai_base_url: 'http://localhost/'},
    {model_providers: {evil: {}}}, {forced_login_method: 'api'}, {features: {...config.features, shell_tool: true}}, {hooks: {}}]) {
    assert.throws(() => assertAccountSetupConfig({...config, ...change}, features));
  }
});
test('account profiles have one process owner; stale or changed locks are never reclaimed blindly', async () => {
  const root = await temp(); await prepareAccountProfile({root, features});
  const release = await claimAccountProfile(root);
  await assert.rejects(claimAccountProfile(root), /in use/); await release(); await release();
  const next = await claimAccountProfile(root);
  await writeFile(join(root, 'account-process.lock'), 'changed owner');
  await assert.rejects(next, /changed/);
  assert.equal(await readFile(join(root, 'account-process.lock'), 'utf8'), 'changed owner');
});
test('candidate Code Mode permits exactly three feature deltas without relaxing account isolation', () => {
  const config = {model_provider: 'openai', forced_login_method: 'chatgpt', model: null, model_providers: {},
    chatgpt_base_url: 'https://chatgpt.com/backend-api/', approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled',
    features: Object.fromEntries(features.filter(n => n !== 'apps_mcp_path_override').map(n =>
      [n, n === 'skip_host_skill_discovery' || codeModeCandidate.features.includes(n)])),
    mcp_servers: {}, plugins: {}, marketplaces: {}, project_doc_max_bytes: 0, cli_auth_credentials_store: 'file',
    allow_login_shell: false, history: {persistence: 'none'}, analytics: {enabled: false}, feedback: {enabled: false}};
  assert.equal(assertCandidateCodeModeConfig(config, features).productionEnabled, false);
  assert.equal(config.features.code_mode_host, true, 'Assertion must not mutate input');
  assert.throws(() => assertAccountSetupConfig(config, features), /Unexpected effective feature/);
  for (const name of codeModeCandidate.features) {
    assert.throws(() => assertCandidateCodeModeConfig({...config, features: {...config.features, [name]: false}}, features));
  }
  for (const change of [{sandbox_mode: 'workspace-write'}, {web_search: 'live'}, {model: 'fallback'},
    {features: {...config.features, shell_tool: true}}, {features: {...config.features, new_unknown: true}},
    {mcp_servers: {bypass: {}}}, {plugins: {bypass: {}}}, {hooks: {}},
    {chatgpt_base_url: 'http://localhost/'}, {model_providers: {bypass: {}}}]) {
    assert.throws(() => assertCandidateCodeModeConfig({...config, ...change}, features));
  }
});
test('status reads are inert; connect reads only isolated account status and strips PII', async () => {
  const f = fixture(); assert.equal(f.manager.status().phase, 'disconnected'); assert.equal(f.calls.length, 0);
  f.account({type: 'chatgpt', email: 'private@example.test', accessToken: 'do-not-expose'});
  const status = await f.manager.connect(); assert.equal(status.signedIn, true); assert.equal(status.busy, false);
  assert.doesNotMatch(JSON.stringify(status), /private@example|do-not-expose/);
  assert.deepEqual(f.calls, [{method: 'account/read', params: {refreshToken: false}}]); await f.manager.disconnect();
});
test('managed login returns a one-time official link but notifications do not certify sign-in', async () => {
  const f = fixture(); await f.manager.connect(); const result = await f.manager.login();
  assert.equal(result.authUrl, f.login.authUrl); assert.equal(f.manager.status().phase, 'awaiting-sign-in');
  assert.doesNotMatch(JSON.stringify(f.manager.status()), /authUrl|state=|loginId/);
  assert.deepEqual(f.calls.at(-1), {method: 'account/login/start', params: {type: 'chatgpt'}});
  f.emit({method: 'account/login/completed', params: {loginId: f.login.loginId, success: true}});
  assert.equal(f.manager.status().signedIn, null); assert.equal(f.manager.status().phase, 'refresh-required');
  f.account({type: 'chatgpt'}); assert.equal((await f.manager.refresh()).signedIn, true); await f.manager.disconnect();
});
test('early login notifications are correlated after the reply and still require fresh account read', async () => {
  const f = fixture(); await f.manager.connect();
  f.hook(async method => {if (method === 'account/login/start') {
    f.emit({method: 'account/updated', params: {authMode: 'chatgpt'}});
    f.emit({method: 'account/login/completed', params: {loginId: f.login.loginId, success: true}});
    return f.login;
  }});
  await f.manager.login(); assert.equal(f.manager.status().phase, 'refresh-required');
  assert.equal(f.manager.status().signedIn, null); assert.equal(f.manager.status().loginPending, false); await f.manager.disconnect();
});
test('foreign completion cannot satisfy login; cancel uses only the owned login ID', async () => {
  const f = fixture(); await f.manager.connect(); await f.manager.login();
  f.emit({method: 'account/login/completed', params: {loginId: randomUUID(), success: true}});
  assert.equal(f.manager.status().phase, 'awaiting-sign-in'); await f.manager.cancelLogin();
  assert.deepEqual(f.calls.at(-1), {method: 'account/login/cancel', params: {loginId: f.login.loginId}});
  assert.equal(f.manager.status().signedIn, null); await f.manager.disconnect();
});
test('disconnect during login prevents a late URL from being returned and drops stale events', async () => {
  const f = fixture(), entered = latch(), release = latch(); await f.manager.connect();
  f.hook(async method => {if (method === 'account/login/start') {entered.resolve(); await release.promise; return f.login;}});
  const pending = f.manager.login(); await entered.promise; await f.manager.disconnect(); release.resolve();
  await assert.rejects(pending, /setup failed/);
  f.emit({method: 'account/updated', params: {authMode: 'chatgpt'}}); assert.equal(f.manager.status().signedIn, null);
});
test('logout is explicit, account-scoped and verified with a fresh read', async () => {
  const f = fixture(); f.account({type: 'chatgpt'}); await f.manager.connect();
  assert.equal((await f.manager.logout()).signedIn, false); assert.equal(f.calls.at(-2).method, 'account/logout');
  assert.equal(f.calls.at(-1).method, 'account/read'); await f.manager.disconnect();
});
test('malformed account records cannot be reported as signed out', async () => {
  for (const account of [undefined, {}, [], 'chatgpt', {type: null}]) {
    const f = fixture(); f.account(account);
    await assert.rejects(f.manager.connect(), /setup failed/);
    assert.equal(f.manager.status().signedIn, null); assert.equal(f.closed(), 1);
  }
});
test('late cancellation reply cannot resurrect a disconnected setup', async () => {
  const f = fixture(), entered = latch(), release = latch();
  await f.manager.connect(); await f.manager.login();
  f.hook(async method => {if (method === 'account/login/cancel') {entered.resolve(); await release.promise; return {};}});
  const pending = f.manager.cancelLogin(); await entered.promise;
  await f.manager.disconnect(); release.resolve();
  await assert.rejects(pending, /setup failed/);
  assert.equal(f.manager.status().phase, 'error'); assert.equal(f.manager.status().signedIn, null);
  assert.equal(f.manager.status().loginPending, false);
});
test('concurrent disconnect and reconnect wait for actual transport shutdown', async () => {
  const f = fixture(), entered = latch(), release = latch(); await f.manager.connect();
  let closes = 0, secondDone = false;
  f.rpc.close = async () => {closes++; entered.resolve(); await release.promise;};
  const first = f.manager.disconnect(); await entered.promise;
  const second = f.manager.disconnect().then(() => {secondDone = true;});
  const reads = f.calls.length, reconnect = f.manager.connect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(secondDone, false); assert.equal(f.calls.length, reads); assert.equal(closes, 1);
  release.resolve(); await Promise.all([first, second, reconnect]);
  assert.equal(f.manager.status().phase, 'ready'); assert.equal(f.calls.length, reads + 1);
  await f.manager.disconnect();
});
test('unexpected login destination, token mode and account type fail closed without exposing details', async () => {
  for (const authUrl of ['javascript:alert(1)', 'https://chatgpt.com.evil.example/', 'http://chatgpt.com/', 'https://user@chatgpt.com/', 'https://auth.openai.com:8443/']) {
    assert.throws(() => managedLogin({type: 'chatgpt', loginId: randomUUID(), authUrl}));
  }
  assert.throws(() => managedLogin({type: 'chatgptAuthTokens', loginId: randomUUID(), authUrl: 'https://chatgpt.com/'}));
  const f = fixture(); f.account({type: 'apiKey', private: 'secret'});
  await assert.rejects(f.manager.connect(), error => !error.message.includes('secret'));
  assert.equal(f.closed(), 1); assert.equal(f.manager.status().modelExecutionEnabled, false);
});
test('failed cleanup is redacted and stays latched across account operations', async () => {
  for (const trigger of ['refresh', 'disconnect']) {
    const f = fixture(); await f.manager.connect();
    let closes = 0;
    f.rpc.close = async () => {closes++; throw Error('ENOENT /private/profile/account-process.lock secret-detail');};
    f.hook(async () => {throw Error('private transport failure');});
    const generic = error => {
      assert.match(error.message, /Isolated Codex account setup failed/);
      assert.doesNotMatch(error.message, /ENOENT|\/private|secret-detail|transport failure/);
      return true;
    };
    await assert.rejects(f.manager[trigger](), generic);
    const calls = f.calls.length;
    for (const operation of ['connect', 'refresh', 'disconnect']) {
      await assert.rejects(f.manager[operation](), generic);
      assert.equal(f.manager.status().phase, 'error');
      assert.equal(f.manager.status().signedIn, null);
      assert.equal(f.manager.status().modelExecutionEnabled, false);
      assert.equal(f.manager.status().busy, false);
      assert.equal(f.calls.length, calls);
      assert.equal(closes, 1);
    }
  }
});
test('account-only transport refuses model turns, mutations and provider callbacks', async () => {
  const rpc = new CodexAgent({accountOnly: true, toolSession: {handle: () => {throw Error('must not be called');}, close: async () => {}}});
  const sent = []; rpc.send = m => sent.push(m);
  for (const method of ['thread/start', 'turn/start', 'process/spawn', 'config/value/write', 'account/rateLimitResetCredit/consume']) await assert.rejects(rpc.request(method, {}));
  assert.equal(sent.length, 0); await rpc.receive({id: 1, method: 'item/tool/call', params: {}});
  assert.equal(sent[0].error.code, -32601); await rpc.close();
  const ordinary = new CodexAgent(); await assert.rejects(ordinary.request('account/login/start', {type: 'chatgpt'})); await ordinary.close();
});
