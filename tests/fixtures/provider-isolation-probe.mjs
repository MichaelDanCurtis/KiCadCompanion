// Opt-in qualification of a pinned real executable, with synthetic local model
// responses and an in-memory adapter. Never imports/registers native adapters.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, writeFile, readFile, realpath, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../../server/config.mjs';
import {ActionGate} from '../../server/actions.mjs';
import {FixtureAdapter} from '../../server/adapters/fixture.mjs';
import {createProviderToolSession} from '../../server/provider-tools.mjs';
import {CodexAgent} from '../../server/codex.mjs';
import {MediatedProviderSession} from '../../server/provider-session.mjs';
import {codeModeCandidate} from '../../server/provider-profile.mjs';
import {assertProbeBinary, parseProbeFeatures, probeEnvironment, probeConfiguration,
  assertEffectiveProbeConfig, assertProbeToolInventory, probeQualification, sha256} from '../../server/provider-isolation.mjs';

assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--code-mode'));
const codeMode = process.argv.includes('--code-mode');

const root = await realpath(await mkdtemp(join(tmpdir(), 'benchline-provider-probe-')));
await mkdir(join(root, 'codex')); await mkdir(join(root, 'workspace'));
const env = probeEnvironment(root), binary = config.codex;
const exec = promisify(execFile);
// Even discovery runs with the separate profile and stripped environment.
const binaryBytes = await readFile(binary);
assertProbeBinary(probeQualification.version, binaryBytes);
assertProbeBinary((await exec(binary, ['--version'], {env})).stdout, binaryBytes);
const features = parseProbeFeatures((await exec(binary, ['features', 'list'], {env})).stdout);
if (codeMode) assert.equal(sha256(await readFile(join(dirname(binary), 'codex-code-mode-host'))), codeModeCandidate.hostSha256);
const report = {at: new Date().toISOString(), qualification: probeQualification,
  codeMode, ...(codeMode ? {codeModeCandidate} : {}), scenarios: [], modelRequests: 0};
let child, rpc, session, active, definitions, failure, toolIndex = 0;
const fail = error => {failure ||= error; active?.reject(error);};
const tool = (name, args) => {
  const index = ++toolIndex;
  // Keep forged unadvertised calls raw; legitimate mediation uses the actual
  // Code Mode exec host, not a fabricated direct callback into the client.
  if (codeMode && ['benchline_prepare_action', 'benchline_execute_action', 'benchline_action_status'].includes(name)) {
    return {type: 'custom_tool_call', id: `ct_${index}`, call_id: `call_${index}`, name: 'exec',
      input: `text(await tools.${name}(${JSON.stringify(args)}));`};
  }
  return {type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`, name, arguments: JSON.stringify(args)};
};
const finalMessage = () => ({id: `msg_${++toolIndex}`, type: 'message', role: 'assistant', status: 'completed',
  content: [{type: 'output_text', text: 'Synthetic qualification complete.', annotations: []}]});
const unpack = response => JSON.parse(response.contentItems[0].text);

const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/responses'); assert.equal(req.headers.authorization, undefined);
    let data = '';
    for await (const chunk of req) {data += chunk; assert.ok(data.length < 2_000_000);}
    const body = JSON.parse(data);
    if (codeMode) {
      assert.deepEqual(body.tools.map(t => t.name).sort(), ['exec', 'request_user_input', 'wait']);
      const execute = body.tools.find(t => t.name === 'exec');
      assert.equal(execute.type, 'custom'); assert.equal(execute.format?.type, 'grammar');
      const declarations = [...execute.description.matchAll(/^### `([^`]+)`$/gm)].map(match => match[1]).sort();
      assert.deepEqual(declarations, definitions.map(t => t.name).sort());
      report.tools = body.tools.map(t => t.name).sort();
      report.nestedDeclarations = declarations;
    } else report.tools = assertProbeToolInventory(body.tools, definitions).names;
    report.modelRequests++;
    assert.ok(active, 'No host-owned scenario');
    const step = active.steps[active.step++]; assert.ok(step, 'Unexpected extra model request');
    const item = await step(body) || finalMessage();
    if (res.destroyed || active?.expectedStatus === 'interrupted') {res.end(); return;}
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    for (const event of [
      {type: 'response.created', response: {id: `resp_${toolIndex}`, status: 'in_progress', output: []}},
      {type: 'response.output_item.done', output_index: 0, item},
      {type: 'response.completed', response: {id: `resp_${toolIndex}`, status: 'completed', output: [item],
        usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}},
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  } catch (error) {fail(error); res.writeHead(500).end('Synthetic probe assertion failed');}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
async function startProcess() {
  child = spawn(binary, ['app-server', '--strict-config', '--listen', 'stdio://'],
    {cwd: join(root, 'workspace'), env, stdio: ['pipe', 'pipe', 'pipe']});
  rpc = new CodexAgent({onStatus: status => {if (!status.connected) fail(Error(status.error));}}).attach(child);
  const respond = rpc.respond.bind(rpc);
  rpc.respond = (id, result) => {active?.callbacks.push({result}); respond(id, result);};
  const initialized = await rpc.request('initialize', {clientInfo: {name: 'benchline_isolation_probe', version: '0.1.0'},
    capabilities: {experimentalApi: true}});
  assert.equal(await realpath(initialized.codexHome), join(root, 'codex'));
  rpc.send({method: 'initialized'});
  const effective = await rpc.request('config/read', {includeLayers: false, cwd: join(root, 'workspace')});
  const baseline = structuredClone(effective.config);
  if (codeMode) for (const feature of codeModeCandidate.features) {
    assert.equal(effective.config.features[feature], true); baseline.features[feature] = false;
  }
  report.effective = {...assertEffectiveProbeConfig(baseline, features, endpoint),
    ...(codeMode ? {candidateFeatureDelta: [...codeModeCandidate.features]} : {})};
}
async function stopProcess() {
  await rpc?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => child.once('exit', resolve));
  }
}
try {
  let configuration = probeConfiguration(features, endpoint);
  if (codeMode) for (const name of codeModeCandidate.features) configuration = configuration.replace(`${name}=false`, `${name}=true`);
  await writeFile(join(root, 'codex/config.toml'), configuration, {mode: 0o600});
  async function scenario(name, mode, build, {waitForApproval = false} = {}) {
    const adapter = new FixtureAdapter(), projectId = randomUUID(), documentId = randomUUID();
    const target = {projectId, documentId, path: join(root, 'workspace/fixture.txt'), epoch: randomUUID(), manifestHash: 'synthetic'};
    const gate = new ActionGate({path: join(root, `${name}.json`), adapters: new Map([['fixture', adapter]]),
      resolveTarget: async input => {assert.equal(input.projectId, projectId); assert.equal(input.documentId, documentId); return {...target};}});
    await gate.init();
    const options = {gate, projectId, documentIds: [documentId], mode, waitForApproval};
    const provisional = await createProviderToolSession({...options, threadId: 'schema-only'});
    definitions = provisional.tools(); await provisional.close();
    await startProcess();
    session = await MediatedProviderSession.open({rpc, gate, waitForApproval, scope: {projectId, documentIds: [documentId], mode},
      onEvent: message => {
        if (message.method === 'turn/completed' && message.params.threadId === active?.threadId) {
          try {
            assert.equal(message.params.turn.status, active.expectedStatus || 'completed');
            active.completedStatus = message.params.turn.status; active.resolve();
          } catch (error) {active.reject(error);}
        }
      }});
    let resolve, reject;
    const done = new Promise((yes, no) => {resolve = yes; reject = no;});
    // Attach immediately so a process failure during turn/start is not unhandled.
    done.catch(() => {});
    const state = {threadId: session.snapshot().threadId, step: 0, callbacks: [], resolve, reject};
    active = state;
    const context = {gate, adapter, documentId, projectId, state,
      prepare: (operation = 'set-label') => tool('benchline_prepare_action', {documentId, adapter: 'fixture', operation,
        args: operation === 'set-label' ? {value: 'Synthetic approved label'} : {}}),
      last: () => state.callbacks.at(-1)?.result};
    state.steps = build(context);
    const timer = setTimeout(() => reject(Error(`Scenario timeout: ${name}`)), 20000);
    try {
      await session.startTurn(`Synthetic local qualification: ${name}. No customer project data.`);
      await done;
      await state.stopPromise;
      await state.decisionPromise;
      await state.after?.();
      assert.equal(session.snapshot().phase, 'ready');
      if (failure) throw failure;
      assert.equal(state.step, state.steps.length);
      report.scenarios.push({name, passed: true, callbacks: state.callbacks.length, adapterDispatches: adapter.calls,
        recurringGrants: gate.list(projectId).grants.length, turnStatus: state.completedStatus});
    } finally {clearTimeout(timer); active = null; await session.close(); session = null; await stopProcess();}
  }

  await scenario('discuss-read-and-write-denial', 'discuss', ({prepare, last, adapter}) => [
    () => prepare(),
    () => {assert.equal(last().success, false); assert.equal(adapter.calls, 0); return prepare('read-label');},
    () => {assert.equal(unpack(last()).state, 'ready'); return tool('benchline_execute_action', {actionId: unpack(last()).actionId});},
    () => {assert.equal(unpack(last()).state, 'verified'); assert.equal(adapter.calls, 1); assert.equal(adapter.value, 'initial');},
  ]);

  for (const decision of ['once', 'decline', 'stop']) {
    await scenario(`product-wait-for-${decision}`, 'agent', ({prepare, last, adapter, gate, state}) => {
      const original = gate.prepare.bind(gate);
      gate.prepare = async (...args) => {
        const action = await original(...args);
        // The synthetic host waits independently of the model stream. A second
        // model response cannot be used to approve a still-pending callback.
        state.decisionPromise = (async () => {
          await delay(1000);
          assert.equal(state.callbacks.length, 0);
          assert.equal(gate.get(action.id).state, 'awaiting-approval');
          assert.equal(session.snapshot().phase, 'working');
          assert.equal(adapter.calls, 0);
          if (decision === 'stop') {
            state.expectedStatus = 'interrupted';
            state.stopPromise = session.stop(); await state.stopPromise;
            assert.equal(gate.get(action.id).state, 'cancelled');
          } else await gate.decide(action.id, decision);
        })();
        state.decisionPromise.catch(fail);
        return action;
      };
      if (decision === 'stop') return [() => prepare()];
      if (decision === 'decline') return [() => prepare(), () => {
        assert.equal(unpack(last()).state, 'declined'); assert.equal(adapter.calls, 0);
      }];
      return [() => prepare(), () => {
        assert.equal(unpack(last()).state, 'approved'); assert.equal(adapter.calls, 0);
        return tool('benchline_execute_action', {actionId: unpack(last()).actionId});
      }, () => {assert.equal(unpack(last()).state, 'verified'); assert.equal(adapter.calls, 1);}];
    }, {waitForApproval: true});
  }

  await scenario('agent-once-no-self-approval-or-replay', 'agent', ({prepare, last, adapter, gate, projectId}) => {
    let actionId;
    return [
      () => prepare(),
      () => {assert.equal(unpack(last()).state, 'awaiting-approval'); actionId = unpack(last()).actionId;
        return tool('benchline_execute_action', {actionId});},
      () => {assert.equal(last().success, false); assert.equal(adapter.calls, 0);
        return tool('benchline_prepare_action', {decision: 'always', mode: 'agent'});},
      async () => {assert.equal(last().success, false); assert.equal(adapter.calls, 0);
        // Synthetic host test decision, not a provider tool or real human click.
        await gate.decide(actionId, 'once'); return tool('benchline_execute_action', {actionId});},
      () => {assert.equal(unpack(last()).state, 'verified'); return tool('benchline_execute_action', {actionId});},
      () => {assert.equal(unpack(last()).state, 'verified'); assert.equal(adapter.calls, 1);
        assert.equal(adapter.value, 'Synthetic approved label'); assert.equal(gate.list(projectId).grants.length, 0);},
    ];
  });

  await scenario('agent-declined-write', 'agent', ({prepare, last, adapter, gate}) => [
    () => prepare(),
    async () => {const actionId = unpack(last()).actionId; await gate.decide(actionId, 'decline');
      return tool('benchline_execute_action', {actionId});},
    () => {assert.equal(last().success, false); assert.equal(adapter.calls, 0); assert.equal(adapter.value, 'initial');},
  ]);

  await scenario('agent-scoped-always-and-revoke', 'agent', ({prepare, last, adapter, gate, documentId, projectId}) => {
    let actionId, grantId;
    return [
      () => prepare(),
      async () => {actionId = unpack(last()).actionId; await gate.decide(actionId, 'always');
        grantId = gate.get(actionId).grantId; return tool('benchline_execute_action', {actionId});},
      () => {assert.equal(unpack(last()).state, 'verified'); return prepare();},
      () => {assert.equal(unpack(last()).state, 'approved'); return tool('benchline_execute_action', {actionId: unpack(last()).actionId});},
      () => {assert.equal(unpack(last()).state, 'verified'); assert.equal(adapter.calls, 2);
        return tool('benchline_prepare_action', {documentId, adapter: 'fixture', operation: 'set-label', args: {value: 'Changed scope'}});},
      () => {assert.equal(unpack(last()).state, 'awaiting-approval'); return tool('benchline_execute_action', {actionId: unpack(last()).actionId});},
      () => {assert.equal(last().success, false); return prepare();},
      async () => {assert.equal(unpack(last()).state, 'approved'); actionId = unpack(last()).actionId;
        await gate.revoke(grantId); return tool('benchline_execute_action', {actionId});},
      () => {assert.equal(last().success, false); assert.equal(adapter.calls, 2);
        assert.equal(gate.list(projectId).grants.length, 0); assert.equal(adapter.value, 'Synthetic approved label');},
    ];
  });

  await scenario('agent-stale-after-manual-fixture-edit', 'agent', ({prepare, last, adapter, gate}) => [
    () => prepare(),
    async () => {
      const actionId = unpack(last()).actionId; await gate.decide(actionId, 'once');
      adapter.revision++; adapter.value = 'manual fixture edit';
      return tool('benchline_execute_action', {actionId});
    },
    () => {assert.equal(last().success, false); assert.equal(adapter.calls, 0); assert.equal(adapter.value, 'manual fixture edit');},
  ]);

  await scenario('agent-applied-response-loss-no-replay', 'agent', ({prepare, last, adapter, gate}) => {
    let actionId;
    const execute = adapter.execute.bind(adapter);
    adapter.execute = async (...args) => {await execute(...args); throw Error('Synthetic lost response after fixture mutation');};
    return [
      () => prepare(),
      async () => {actionId = unpack(last()).actionId; await gate.decide(actionId, 'once'); return tool('benchline_execute_action', {actionId});},
      () => {assert.equal(last().success, false); assert.equal(unpack(last()).state, 'unknown'); return tool('benchline_execute_action', {actionId});},
      () => {assert.equal(last().success, false); assert.equal(unpack(last()).state, 'unknown');
        assert.equal(adapter.calls, 1); assert.equal(adapter.value, 'Synthetic approved label');},
    ];
  });

  await scenario('agent-stop-pending-approval', 'agent', ({prepare, last, adapter, gate, state}) => [
    () => prepare(),
    async () => {
      const actionId = unpack(last()).actionId;
      assert.equal(gate.get(actionId).state, 'awaiting-approval'); state.expectedStatus = 'interrupted';
      state.stopPromise = session.stop(); await state.stopPromise;
      assert.equal(gate.get(actionId).state, 'cancelled'); assert.equal(adapter.calls, 0);
      await assert.rejects(gate.decide(actionId, 'once'));
    },
  ]);

  await scenario('agent-stop-after-applied-change', 'agent', ({prepare, last, adapter, gate, state}) => [
    () => prepare(),
    async () => {const actionId = unpack(last()).actionId; await gate.decide(actionId, 'once'); return tool('benchline_execute_action', {actionId});},
    async () => {
      const actionId = unpack(last()).actionId; assert.equal(gate.get(actionId).state, 'verified');
      state.expectedStatus = 'interrupted'; state.stopPromise = session.stop(); await state.stopPromise;
      assert.equal(gate.get(actionId).state, 'verified');
      assert.equal(adapter.calls, 1); assert.equal(adapter.value, 'Synthetic approved label');
    },
  ]);

  await scenario('agent-stop-during-dispatched-change', 'agent', ({prepare, last, adapter, gate, state}) => {
    let actionId;
    const execute = adapter.execute.bind(adapter);
    adapter.execute = async (...args) => {
      const receipt = await execute(...args);
      // Stop while the action is still dispatching, after the fixture changed,
      // not merely after a fully verified result was already delivered.
      assert.equal(gate.get(actionId).state, 'executing');
      state.expectedStatus = 'interrupted'; state.stopPromise = session.stop();
      await state.stopPromise; return receipt;
    };
    state.after = async () => {
      await gate.queue(async () => {}); // Drain existing dispatch; do not replay it.
      assert.equal(gate.get(actionId).state, 'verified');
      assert.match(gate.get(actionId).detail, /applied changes were not undone/);
      assert.equal(adapter.calls, 1); assert.equal(adapter.value, 'Synthetic approved label');
    };
    return [
      () => prepare(),
      async () => {actionId = unpack(last()).actionId; await gate.decide(actionId, 'once'); return tool('benchline_execute_action', {actionId});},
    ];
  });

  for (const name of ['exec_command', 'shell', 'apply_patch', 'mcp__unconfigured__write', 'benchline_decide']) {
    await scenario(`unadvertised-${name}`, 'agent', ({state, adapter}) => [
      () => tool(name, {cmd: `touch ${join(root, 'workspace/forbidden-marker')}`, command: ['touch', join(root, 'workspace/forbidden-marker')], decision: 'always'}),
      async body => {
        assert.equal(state.callbacks.length, 0); assert.equal(adapter.calls, 0);
        const output = body.input.filter(item => item.type === 'function_call_output').at(-1);
        assert.ok(output, 'Expected rejection returned to the synthetic model');
        assert.match(JSON.stringify(output.output), /unrecognized|unknown|not found|not available|unsupported/i);
        await assert.rejects(access(join(root, 'workspace/forbidden-marker')), {code: 'ENOENT'});
      },
    ]);
  }
  await scenario('unadvertised-custom-patch', 'agent', ({state, adapter}) => [
    () => ({type: 'custom_tool_call', id: `ct_${++toolIndex}`, call_id: `call_${toolIndex}`, name: 'apply_patch',
      input: `*** Begin Patch\n*** Add File: ${join(root, 'workspace/forbidden-marker')}\n+must not be created\n*** End Patch`}),
    async body => {
      assert.equal(state.callbacks.length, 0); assert.equal(adapter.calls, 0);
      const output = body.input.filter(item => item.type === 'custom_tool_call_output').at(-1);
      assert.ok(output, 'Expected custom-tool rejection returned to the synthetic model');
      assert.match(JSON.stringify(output.output), /unrecognized|unknown|not found|not available|unsupported/i);
      await assert.rejects(access(join(root, 'workspace/forbidden-marker')), {code: 'ENOENT'});
    },
  ]);
  report.passed = true;
  report.limitations = ['Synthetic loopback provider only; no authenticated model/provider qualification',
    'No OS confinement or arbitrary-host-RPC attestation', 'No production session wiring or native write qualification',
    'Built-in question tool remains advertised; client rejects non-mediated server requests'];
} catch (error) {
  report.passed = false; report.failure = error.message; process.exitCode = 1;
} finally {
  active = null; await session?.close(); await stopProcess();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(join(root, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({...report, receipt: join(root, 'receipt.json')}, null, 2));
}
