import {spawn} from 'node:child_process';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function neutralLaunchEnvironment(base, root = checkout) {
  if (!isAbsolute(root)) throw Error('Neutral launcher requires an absolute checkout root');
  // Do not import server/config here: inherited project/provider settings must
  // be discarded before that module is evaluated in the launch child.
  const env = Object.fromEntries(Object.entries(base).filter(([key, value]) =>
    value !== undefined && !key.startsWith('BENCHLINE_') && !key.startsWith('COMPANION_')));
  return {...env,
    // Empty means checkout/projects with projectSelected=false, not an explicit
    // selection of that directory. All customer/action/provider bindings vanish.
    BENCHLINE_WORKSPACE: '', BENCHLINE_BOARDS_DIR: '.',
    BENCHLINE_STATE_DIR: join(root, '.runtime', 'benchline'),
    BENCHLINE_PORT: '4318', BENCHLINE_AUTOCONNECT: '0',
  };
}

export function neutralLaunchPlan({root = checkout, env = process.env, argv = [], execPath = process.execPath} = {}) {
  if (argv.length > 1 || argv.some(value => value !== '--server-only')) throw Error('Neutral launch supports only --server-only');
  return {command: execPath, args: [join(root, 'scripts', 'launch.mjs'), ...argv],
    options: {cwd: root, env: neutralLaunchEnvironment(env, root), stdio: 'inherit'}};
}

// Keep launch.mjs as the sole server/port ownership authority. Its /api/state
// identity check reuses the matching neutral server and refuses another project.
export async function runNeutralLaunch(options = {}, {spawnProcess = spawn} = {}) {
  const plan = neutralLaunchPlan(options);
  return new Promise((resolveExit, reject) => {
    const child = spawnProcess(plan.command, plan.args, plan.options);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) reject(Error('Neutral launcher was interrupted'));
      else resolveExit(code ?? 1);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {process.exitCode = await runNeutralLaunch({argv: process.argv.slice(2)});}
  catch {console.error('Neutral Benchline launch failed. Inspect the launcher diagnostic; no customer settings were adopted.'); process.exitCode = 1;}
}
