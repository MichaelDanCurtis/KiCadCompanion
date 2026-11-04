import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {neutralLaunchEnvironment, neutralLaunchPlan, runNeutralLaunch} from '../scripts/launch-neutral.mjs';
import {configuration} from '../server/config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const inherited = {BENCHLINE_WORKSPACE: '/customer/board-project', COMPANION_WORKSPACE: '/older/customer-project',
  BENCHLINE_BOARDS_DIR: '/customer/boards', COMPANION_BOARDS_DIR: '../outside',
  BENCHLINE_STATE_DIR: '/customer/state', COMPANION_RUNTIME_DIR: '/customer/legacy-state',
  BENCHLINE_PORT: '9000', COMPANION_PORT: 'invalid', BENCHLINE_AUTOCONNECT: '1', COMPANION_AUTOCONNECT: '1',
  BENCHLINE_KONNECT_CONFIG: '/customer/native.toml', BENCHLINE_KICAD_IPC: 'ipc:///customer/api.sock',
  BENCHLINE_NATIVE_MODEL_REGISTRATION: '/customer/registration.json',
  BENCHLINE_PROVIDER_RUNTIME: 'local-dispatch-v1', BENCHLINE_PROVIDER_MODEL: 'customer-model',
  BENCHLINE_FUTURE_BINDING: 'future customer setting', COMPANION_FUTURE_BINDING: 'legacy future setting'};

test('neutral launch drops inherited project/native/provider settings without mutating the caller', () => {
  const base = {...inherited, PATH: '/tools', CODEX_BIN: '/tools/codex', KONNECT_BIN: '/tools/konnect', KICAD_CLI: '/tools/kicad-cli'};
  const before = structuredClone(base), env = neutralLaunchEnvironment(base, '/standalone');
  assert.deepEqual(base, before);
  assert.deepEqual(env, {PATH: '/tools', CODEX_BIN: '/tools/codex', KONNECT_BIN: '/tools/konnect', KICAD_CLI: '/tools/kicad-cli',
    BENCHLINE_WORKSPACE: '', BENCHLINE_BOARDS_DIR: '.', BENCHLINE_STATE_DIR: '/standalone/.runtime/benchline',
    BENCHLINE_PORT: '4318', BENCHLINE_AUTOCONNECT: '0'});
  const config = configuration({root: '/standalone', home: '/test-home', platform: 'linux', env});
  assert.equal(config.projectSelected, false); assert.equal(config.workspace, '/standalone/projects');
  assert.equal(config.boardsDir, config.workspace); assert.equal(config.autoConnect, false); assert.equal(config.port, 4318);
  assert.equal(config.stateRoot, '/standalone/.runtime/benchline');
  assert.equal(config.runtime, '/standalone/.runtime/benchline/projects/unconfigured');
  for (const key of ['actionKonnectConfig', 'actionIpcAddress', 'nativeModelRegistration', 'providerRuntime', 'providerModel']) assert.equal(config[key], null);
});

test('neutral wrapper forwards server-only to the existing launcher with sanitized child env', async () => {
  let observed;
  const result = await runNeutralLaunch({root: '/standalone', env: inherited, argv: ['--server-only'], execPath: '/tools/node'}, {
    spawnProcess(command, args, options) {
      observed = {command, args, options}; const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 7, null)); return child;
    },
  });
  assert.equal(result, 7);
  assert.equal(observed.command, '/tools/node');
  assert.deepEqual(observed.args, ['/standalone/scripts/launch.mjs', '--server-only']);
  assert.equal(observed.options.cwd, '/standalone'); assert.equal(observed.options.stdio, 'inherit');
  assert.deepEqual(observed.options.env, neutralLaunchEnvironment(inherited, '/standalone'));
  assert.throws(() => neutralLaunchPlan({argv: ['--project=/customer']}));
  assert.throws(() => neutralLaunchPlan({argv: ['--server-only', '--server-only']}));
});

test('neutral wrapper reports process startup failure instead of successful launch', async () => {
  const error = Error('synthetic startup failure');
  await assert.rejects(runNeutralLaunch({root: '/standalone', env: {}}, {spawnProcess() {
    const child = new EventEmitter(); queueMicrotask(() => child.emit('error', error)); return child;
  }}), value => value === error);
});

// Exercise launch.mjs's actual occupied-port identity guard using only a mocked
// /api/state response. Native/server spawning and UI opening are hard-disabled
// inside this isolated test process; no real port or customer service is touched.
async function launchAgainstState(kind) {
  const source = `
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    import {config} from './server/config.mjs';
    import {instanceIdentity} from './server/instance.mjs';
    const forbidden = () => {throw Error('Unexpected test process or UI launch');};
    childProcess.spawn = forbidden; childProcess.execFileSync = forbidden; syncBuiltinESMExports();
    const state = instanceIdentity(config, ${JSON.stringify(root)});
    if (${JSON.stringify(kind)} === 'customer') state.workspace = '/customer/other-project';
    globalThis.fetch = async url => {
      if (url !== 'http://127.0.0.1:4318/api/state') throw Error('Unexpected endpoint');
      return {ok: ${JSON.stringify(kind)} !== 'foreign', json: async () => state};
    };
    process.argv.push('--server-only');
    await import('./scripts/launch.mjs');
  `;
  return promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], {cwd: root,
    env: neutralLaunchEnvironment({...inherited, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR}, root),
    timeout: 5000, maxBuffer: 32768});
}

test('existing neutral server is reused by the original guard without another server or UI launch', async () => {
  const result = await launchAgainstState('neutral');
  assert.equal(result.stdout.trim(), 'http://127.0.0.1:4318'); assert.equal(result.stderr, '');
});

test('occupied customer workspace or foreign service is refused instead of adopted', async () => {
  for (const kind of ['customer', 'foreign']) {
    await assert.rejects(launchAgainstState(kind), error => error.code === 1 &&
      /different app, checkout, project|occupied by another service/.test(error.stderr) &&
      !error.stderr.includes('Unexpected test process or UI launch'));
  }
});
