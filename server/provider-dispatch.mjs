import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {sha256} from './provider-isolation.mjs';
import {canonical} from './actions.mjs';

// Private qualification candidate only. This does not enable a production mode,
// replace the account owner marker, or trust an arbitrary executable path.
export const sourceDispatchCandidate = Object.freeze({
  version: 'codex-app-server 0.153.4',
  revision: '3d2ee51ca2d5db578f328aa75e20aa22c0197c9a',
  binarySha256: '76b0aba0eb92eb0e7f883c5c30962e40996fe16b71aaf583c07b5d15f9b70869',
  productionEnabled: false,
});
export const dispatchAllowlist = Object.freeze({functions: Object.freeze([
  'exec', 'wait', 'benchline_prepare_action', 'benchline_action_status', 'benchline_execute_action',
])});

export function assertSourceDispatchBinary(version, bytes) {
  if (version.trim() !== sourceDispatchCandidate.version || sha256(bytes) !== sourceDispatchCandidate.binarySha256) {
    throw Error('Source dispatcher changed; candidate requalification required');
  }
}

export async function sourceDispatchLaunch() {
  const binary = fileURLToPath(new URL('../.runtime/codex-boundary-source/codex-rs/target/debug/codex-app-server', import.meta.url));
  // Hash before spawning even --version. Only this locally qualified executable
  // may open the existing managed account profile in the explicit test path.
  assertSourceDispatchBinary(sourceDispatchCandidate.version, await readFile(binary));
  return {binary, prefix: [], overrides: ['-c',
    `features.tool_registry.execution_allowlist={functions=${JSON.stringify(dispatchAllowlist.functions)}}`]};
}

export function withoutSourceDispatchConfig(config) {
  if (canonical(config?.features?.tool_registry) !== canonical({execution_allowlist: dispatchAllowlist})) {
    throw Error('Source dispatcher effective allowlist mismatch');
  }
  const baseline = structuredClone(config);
  delete baseline.features.tool_registry;
  return baseline;
}
