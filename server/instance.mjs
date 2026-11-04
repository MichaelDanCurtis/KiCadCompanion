import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function instanceIdentity(config, root) {
  return { product: 'benchline', instanceRoot: root, workspace: config.workspace,
    projectSelected: config.projectSelected, projectKey: config.projectKey, runtime: config.runtime };
}

export function assertInstance(actual, expected) {
  if (!actual || Object.keys(expected).some(key => actual[key] !== expected[key])) {
    throw new Error('Port or state belongs to a different app, checkout, project, or state directory. Choose a separate BENCHLINE_PORT / BENCHLINE_STATE_DIR.');
  }
}

export async function claimState(config, root) {
  await mkdir(config.runtime, { recursive: true, mode: 0o700 });
  const path = join(config.runtime, 'instance.json');
  const expected = instanceIdentity(config, root);
  const entries = await readdir(config.runtime);
  if (!entries.includes('instance.json') && entries.some(name => name !== 'server.log')) {
    throw new Error('Unowned state directory is not empty; select a fresh BENCHLINE_STATE_DIR. No history or permissions were imported.');
  }
  try {
    await writeFile(path, JSON.stringify(expected, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Unknown/old state is never implicitly adopted as Benchline state.
    assertInstance(JSON.parse(await readFile(path, 'utf8')), expected);
  }
  return expected;
}
