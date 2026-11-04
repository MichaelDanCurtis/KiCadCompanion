import {readFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, parse} from 'node:path';
import {assertProbeBinary, probeQualification, sha256} from './provider-isolation.mjs';
import {sourceDispatchLaunch} from './provider-dispatch.mjs';
import {codeModeCandidate, openCandidateSourceDispatchProfile} from './provider-profile.mjs';
import {openCandidateModelTransport} from './provider-model.mjs';
import {ownedCodeModeGateway} from './owned-code-mode-gateway.mjs';

const unsupported = reason => Object.assign(Error(reason), {status: 422});
const unavailable = 'The local provider runtime is unavailable or changed; requalification is required.';

async function verifyRuntime({binary}) {
  // Read-only capability qualification: do not spawn even --version, create a
  // profile, inspect credentials or contact a provider from a capability read.
  assertProbeBinary(probeQualification.version, await readFile(binary));
  await sourceDispatchLaunch();
  if (sha256(await readFile(join(dirname(binary), 'codex-code-mode-host'))) !== codeModeCandidate.hostSha256) {
    throw Error('Code Mode host pin mismatch');
  }
}

function capabilityView(supported, reason) {
  return Object.freeze({version: 1, provider: 'codex-app-server', modes: Object.freeze({
    discuss: Object.freeze({supported, reason}), agent: Object.freeze({supported, reason}),
  })});
}

/** Host-owned local-runtime binding. Configuration and injected dependencies
 * must never come from an HTTP request or model arguments. The default is off.
 * Startup pins are a capability snapshot, not sign-in/model availability proof;
 * opening revalidates executable/configuration pins and the selected model.
 */
export async function createProviderRuntime({enabled = false, binary, root, model} = {}, dependencies = {}) {
  const verify = dependencies.verifyRuntime ?? verifyRuntime;
  const openProfile = dependencies.openProfile ?? openCandidateSourceDispatchProfile;
  const openModel = dependencies.openModel ?? openCandidateModelTransport;
  const openHost = dependencies.openHost ?? ownedCodeModeGateway;
  const configured = enabled === true && typeof binary === 'string' && isAbsolute(binary) &&
    typeof root === 'string' && isAbsolute(root) && root !== parse(root).root &&
    typeof model === 'string' && model.trim().length > 0 && model.length <= 200;
  let supported = false;
  let reason = enabled === true ? 'Select an explicit model and configure the local provider runtime.' :
    'The local provider runtime is disabled; no model session will start.';
  if (configured) {
    try {await verify({binary}); supported = true; reason = 'Pinned local runtime; account and selected model are checked when connecting.';}
    catch {reason = unavailable;}
  }
  const boundary = capabilityView(supported, reason);
  const requireMode = mode => {
    if (!Object.hasOwn(boundary.modes, mode) || !boundary.modes[mode].supported) {
      throw unsupported(Object.hasOwn(boundary.modes, mode) ? reason : 'Unknown provider mode');
    }
  };
  return Object.freeze({boundary, requireMode,
    async openTransport({signal} = {}) {
      signal?.throwIfAborted();
      requireMode('agent');
      let opened;
      try {
        // Recheck before profile setup as well as the opener's own pin checks.
        await verify({binary}); signal?.throwIfAborted();
        opened = await openProfile({binary, root, signal, candidateHostFactory: openHost});
        signal?.throwIfAborted();
        const rpc = await openModel({binary, root, model, signal, openProfile: async () => opened});
        signal?.throwIfAborted();
        return rpc;
      } catch {
        // Existing transports close idempotently. Also clean up when an opener
        // returns after cancellation or model qualification fails before return.
        try {await opened?.rpc.close();} catch {}
        signal?.throwIfAborted();
        throw unsupported('The selected provider could not be qualified. Check account setup, model selection and runtime pins.');
      }
    },
  });
}
