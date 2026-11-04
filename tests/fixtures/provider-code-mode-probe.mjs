// Local synthetic-provider investigation only. No account profile or native CAD.
// This separate profile does NOT change the production isolation policy.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, realpath, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {startCodeModeGateway} from './code-mode-gateway.mjs';
import {config} from '../../server/config.mjs';
import {CodexAgent} from '../../server/codex.mjs';
import {ActionGate} from '../../server/actions.mjs';
import {FixtureAdapter} from '../../server/adapters/fixture.mjs';
import {MediatedProviderSession} from '../../server/provider-session.mjs';
import {dispatchAllowlist, sourceDispatchLaunch, sourceDispatchCandidate, assertSourceDispatchBinary, withoutSourceDispatchConfig} from '../../server/provider-dispatch.mjs';
import {probeEnvironment, probeConfiguration, parseProbeFeatures, assertProbeBinary,
  assertEffectiveProbeConfig, probeQualification, sha256} from '../../server/provider-isolation.mjs';

assert.ok(process.argv.slice(2).every(x => ['--host-enabled', '--exercise', '--gateway', '--source-dispatch'].includes(x)));
const hostEnabled = process.argv.includes('--host-enabled'), exercise = process.argv.includes('--exercise');
const useGateway = process.argv.includes('--gateway');
const sourceDispatch = process.argv.includes('--source-dispatch');
assert.ok(!useGateway || (hostEnabled && exercise));
assert.ok(!sourceDispatch || useGateway);
const root = await realpath(await mkdtemp(join(tmpdir(), 'benchline-code-mode-probe-')));
await mkdir(join(root, 'codex'), {mode: 0o700}); await mkdir(join(root, 'workspace'), {mode: 0o700});
const env = probeEnvironment(root), binary = config.codex, exec = promisify(execFile);
const bytes = await readFile(binary);
assertProbeBinary(probeQualification.version, bytes);
assertProbeBinary((await exec(binary, ['--version'], {env})).stdout, bytes);
const features = parseProbeFeatures((await exec(binary, ['features', 'list'], {env})).stdout);
const hostSha256 = sha256(await readFile(join(dirname(binary), 'codex-code-mode-host')));
assert.equal(hostSha256, 'fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b');
const report = {at: new Date().toISOString(), root, hostEnabled, exercise, hostSha256,
  qualification: probeQualification, requests: 0, callbacks: [], runtimeItems: [], eventMethods: [], productionEnabled: false};
let rpc, session, child, finished, resolveDone, rejectDone, timer, failure;
let host, hostFinished, gateway;
const done = new Promise((resolve, reject) => {resolveDone = resolve; rejectDone = reject;}); done.catch(() => {});
const projectId = randomUUID(), documentId = randomUUID();
const final = () => ({id: 'msg_end', type: 'message', role: 'assistant', status: 'completed',
  content: [{type: 'output_text', text: 'Local fixture completed.', annotations: []}]});
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/responses'); assert.equal(req.headers.authorization, undefined);
    let data = ''; for await (const chunk of req) {data += chunk; assert.ok(data.length < 2_000_000);}
    const body = JSON.parse(data); report.requests++;
    assert.ok(report.requests <= 4);
    report.tools = body.tools;
    report.instructions = typeof body.instructions === 'string' ? body.instructions.slice(0, 16000) : null;
    report.toolOutputs = body.input.filter(i => /tool.*output|function_call_output/.test(i.type));
    let item = final();
    if (sourceDispatch && report.requests === 1) item = {type: 'function_call', id: 'fc_denied', call_id: 'call_denied',
      namespace: 'clock', name: 'curr_time', arguments: '{}'};
    if (exercise && report.requests === (sourceDispatch ? 2 : 1)) item = {type: 'custom_tool_call', id: 'ct_one', call_id: 'call_one',
      name: 'exec', input: `
        text({inventory: ALL_TOOLS.map(t => t.name).sort(), globals: {
          process: typeof process, require: typeof require, fetch: typeof fetch, WebSocket: typeof WebSocket}});
        for (const name of ['exec_command', 'shell', 'apply_patch', 'mcp__unconfigured__write', 'benchline_decide']) {
          text({bypass: name, available: typeof tools[name] === 'function'});
        }
        try { await import('node:fs'); text({nodeImport: 'available'}); } catch { text({nodeImport: 'denied'}); }
        text(await tools.benchline_prepare_action(${JSON.stringify({documentId, adapter: 'fixture', operation: 'set-label', args: {value: 'must-be-denied'}})}));
        const raw = await tools.benchline_prepare_action(${JSON.stringify({documentId, adapter: 'fixture', operation: 'read-label', args: {}})});
        const read = typeof raw === 'string' ? JSON.parse(raw) : raw;
        text(read); text(await tools.benchline_execute_action({actionId: read.actionId}));`};
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    for (const event of [
      {type: 'response.created', response: {id: `r_${report.requests}`, status: 'in_progress', output: []}},
      {type: 'response.output_item.done', output_index: 0, item},
      {type: 'response.completed', response: {id: `r_${report.requests}`, status: 'completed', output: [item],
        usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}},
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  } catch (error) {failure ||= error; rejectDone(error); res.writeHead(500).end('Probe failed');}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
try {
  let configuration = probeConfiguration(features, endpoint);
  const overrides = {code_mode: true, code_mode_only: true, code_mode_host: hostEnabled,
    ...(sourceDispatch ? {current_time_reminder: true} : {})};
  for (const [key, value] of Object.entries(overrides)) configuration = configuration.replace(`${key}=false`, `${key}=${value}`);
  if (sourceDispatch) configuration += '\n[features.tool_registry.execution_allowlist]\nfunctions=' + JSON.stringify(dispatchAllowlist.functions) + '\n';
  await writeFile(join(root, 'codex/config.toml'), configuration, {flag: 'wx', mode: 0o600});
  const hostArgs = [];
  if (useGateway) {
    host = spawn(join(dirname(binary), 'codex-code-mode-host'), ['--listen', 'grpc://127.0.0.1:0'],
      {cwd: join(root, 'workspace'), env, stdio: ['ignore', 'pipe', 'pipe']});
    hostFinished = new Promise(resolve => host.once('close', resolve));
    host.stderr.resume(); // Do not retain code/result-bearing runtime logs.
    const lines = createInterface({input: host.stdout});
    const hostUrl = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(Error('Host startup timed out')), 5000);
      lines.once('line', line => {clearTimeout(deadline); resolve(line);});
      host.once('error', error => {clearTimeout(deadline); reject(error);});
      host.once('exit', () => {clearTimeout(deadline); reject(Error('Host exited before ready'));});
    });
    gateway = await startCodeModeGateway({upstreamUrl: hostUrl});
    hostArgs.push('--code-mode-host', gateway.url);
  }
  let launchBinary = binary, launchPrefix = ['app-server'];
  if (sourceDispatch) {
    // Deliberately only this local build, never a model/client-selected path.
    const launch = await sourceDispatchLaunch();
    launchBinary = launch.binary; launchPrefix = launch.prefix;
    const version = (await exec(launchBinary, ['--version'], {env})).stdout.trim();
    assertSourceDispatchBinary(version, await readFile(launchBinary));
    report.sourceDispatch = {...sourceDispatchCandidate, allowlist: dispatchAllowlist};
  }
  child = spawn(launchBinary, [...launchPrefix, '--strict-config', '--listen', 'stdio://', ...hostArgs],
    {cwd: join(root, 'workspace'), env, stdio: ['pipe', 'pipe', 'pipe']});
  finished = new Promise(resolve => child.once('close', resolve));
  rpc = new CodexAgent({onStatus: s => {if (!s.connected) rejectDone(Error('Process disconnected'));}}).attach(child);
  rpc.onEvent = message => {
    if (!report.eventMethods.includes(message.method)) report.eventMethods.push(message.method);
    assert.ok(report.eventMethods.length < 100, 'Event method bound exceeded');
  };
  const info = await rpc.request('initialize', {clientInfo: {name: 'benchline_code_mode_probe', version: '0.1.0'}, capabilities: {experimentalApi: true}});
  assert.equal(await realpath(info.codexHome), join(root, 'codex')); rpc.send({method: 'initialized'});
  const effective = (await rpc.request('config/read', {includeLayers: false, cwd: join(root, 'workspace')})).config;
  // Verify each experimental delta explicitly, then validate every unchanged
  // policy field with the original checker. This is not the original policy.
  const baseline = sourceDispatch ? withoutSourceDispatchConfig(effective) : structuredClone(effective);
  for (const [key, value] of Object.entries(overrides)) {
    assert.equal(effective.features[key], value); baseline.features[key] = false;
  }
  assertEffectiveProbeConfig(baseline, features, endpoint);
  report.configurationDelta = overrides;
  const adapter = new FixtureAdapter();
  const target = {projectId, documentId, path: join(root, 'workspace/nonexistent.txt'), epoch: randomUUID(), manifestHash: 'fixture'};
  const gate = new ActionGate({path: join(root, 'actions.json'), adapters: new Map([['fixture', adapter]]), resolveTarget: async () => ({...target})});
  await gate.init();
  session = await MediatedProviderSession.open({rpc, gate, scope: {projectId, documentIds: [documentId], mode: 'discuss'},
    onEvent: message => {
      if (message.method === 'item/completed') {
        assert.ok(report.runtimeItems.length < 20, 'Runtime item bound exceeded');
        assert.ok(JSON.stringify(message.params.item).length < 65536, 'Runtime item too large');
        report.runtimeItems.push(message.params.item);
      }
      if (message.method === 'turn/completed') {report.turnStatus = message.params.turn.status; resolveDone();}
    }});
  const handle = session.handle.bind(session);
  session.handle = async message => {const result = await handle(message); report.callbacks.push({tool: message.params?.tool, result}); return result;};
  timer = setTimeout(() => rejectDone(Error('Synthetic Code Mode timeout')), 20000);
  await session.startTurn('Local synthetic Code Mode diagnostic. No customer data.');
  await done; if (failure) throw failure;
  assert.equal(report.turnStatus, 'completed');
  report.adapterDispatches = adapter.calls;
  if (exercise) {
    if (!hostEnabled) {
      assert.equal(report.callbacks.length, 0); assert.equal(adapter.calls, 0);
      assert.ok(JSON.stringify(report.toolOutputs).includes('code-mode host is disabled'));
      report.disabledHostReproduced = true;
    } else {
      assert.equal(report.callbacks.length, 3);
      assert.equal(report.callbacks[0].result.success, false);
      assert.equal(JSON.parse(report.callbacks[2].result.contentItems[0].text).verified, true);
      assert.equal(adapter.calls, 1); assert.equal(adapter.value, 'initial'); assert.equal(adapter.revision, 1);
      const output = report.toolOutputs.find(i => i.type === 'custom_tool_call_output');
      const values = output.output.filter(i => i.type === 'input_text' && i.text.startsWith('{')).map(i => JSON.parse(i.text));
      assert.deepEqual(values[0].inventory, ['benchline_action_status', 'benchline_execute_action', 'benchline_prepare_action']);
      assert.deepEqual(values[0].globals, {process: 'undefined', require: 'undefined', fetch: 'undefined', WebSocket: 'undefined'});
      assert.equal(values.filter(v => v.bypass && v.available === false).length, 5);
      assert.ok(values.some(v => v.nodeImport === 'denied'));
      assert.deepEqual(await readdir(join(root, 'workspace')), []);
      assert.equal(gate.list(projectId).grants.length, 0);
      report.discussBoundary = {writeDenied: true, readVerified: true, fixtureUnchanged: true,
        bypassToolsAbsent: true, nodeImportDenied: true, ioGlobalsAbsent: true, workspaceEmpty: true};
      if (sourceDispatch) {
        const direct = report.toolOutputs.find(item => item.call_id === 'call_denied');
        assert.ok(JSON.stringify(direct).includes('tool execution blocked by the configured execution allowlist'));
        report.sourceDispatch.forgedDirectClockDenied = true;
      }
    }
  }
  report.limitations = ['Synthetic provider only; no authenticated Code Mode qualification',
    'Selected negative checks, not OS confinement or exhaustive JavaScript sandbox validation',
    'No native CAD or user approval UI journey; production remains disabled'];
  if (gateway) {
    assert.equal(gateway.evidence.forwardedExecutions, 1);
    assert.equal(gateway.evidence.rejectedExecutions, 0);
    report.hostAdmission = gateway.evidence;
  }
  report.completed = true;
} catch (error) {report.completed = false; report.failure = error.message; process.exitCode = 1;}
finally {
  clearTimeout(timer); await session?.close(); await rpc?.close(); await finished;
  if (gateway) report.hostAdmission = gateway.evidence;
  await gateway?.close();
  host?.kill('SIGTERM'); if (hostFinished) await hostFinished;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(join(root, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({...report, tools: undefined, instructions: undefined, receipt: join(root, 'receipt.json')}, null, 2));
}
