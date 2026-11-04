import { readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuration, appRoot } from '../server/config.mjs';
import { launcherEnvironment } from './launcher-settings.mjs';

// Configuration-only migration. Never read/copy conversations, credentials,
// permissions, design files, or render payloads. There is deliberately no apply.
export async function migrationPlan({ sourceRoot, sourceState, workspace, root = appRoot, env = {} }) {
  if (!sourceRoot || !sourceState || !workspace) throw new Error('Provide --from-root, --from-state, and --workspace explicitly');
  sourceRoot = resolve(sourceRoot); sourceState = resolve(sourceState); workspace = resolve(workspace);
  if (sourceRoot === resolve(root)) throw new Error('Prototype and Benchline roots must be different');
  for (const path of [sourceRoot, sourceState, workspace]) {
    if (!(await stat(path)).isDirectory()) throw new Error(`Not a directory: ${path}`);
  }
  const config = configuration({ root, env: { ...env, BENCHLINE_WORKSPACE: workspace, BENCHLINE_AUTOCONNECT: env.BENCHLINE_AUTOCONNECT ?? '0' } });
  const entries = await readdir(sourceState);
  const categories = ['session.json', 'permissions.json', 'renders', 'venv', 'server.log']
    .map(name => ({ name, present: entries.includes(name), disposition: 'leave-in-place; do-not-import' }));
  return {
    schemaVersion: 1, mode: 'dry-run', product: 'Benchline', cutover: 'deferred; requires explicit approval',
    source: { root: sourceRoot, state: sourceState, launcher: join(sourceRoot, 'scripts/launch.mjs') },
    target: { root: resolve(root), workspace: config.workspace, state: config.runtime, port: config.port,
      launcher: join(resolve(root), 'scripts/launch.mjs'), nativeBundle: join(resolve(root), '.runtime/Benchline.app') },
    categories, importPermissions: false, importHistory: false,
    previewEnvironment: launcherEnvironment(config),
    steps: ['Leave the prototype running.', 'Review the target environment and choose an unused port.',
      'Build/launch Benchline from its independent checkout with fresh project state.',
      'Select the intended board manually; perform approved read-only smoke checks.',
      'Request cutover approval before changing any existing launcher or stopping the prototype.'],
    rollback: ['Identify the new listener by product, checkout, workspace, and runtime via /api/state.',
      'Stop only that verified Benchline listener after its work is idle.',
      'Return to the untouched prototype launcher. No old files, state, or permissions require restoration.'],
    limitation: 'This report does not inspect whether the prototype is active and does not perform a cutover or data import.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), values = {};
  const allowed = new Set(['--from-root', '--from-state', '--workspace']);
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Usage: npm run migration:plan -- --from-root PATH --from-state PATH --workspace PATH. Dry-run only.');
    values[args[i]] = args[i+1];
  }
  console.log(JSON.stringify(await migrationPlan({ sourceRoot: values['--from-root'], sourceState: values['--from-state'], workspace: values['--workspace'], env: process.env }), null, 2));
}
