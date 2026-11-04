// Opt-in structural qualification only: no login, model turn, native adapter or
// customer project. Uses the actual pinned executable with a new empty profile.
import assert from 'node:assert/strict';
import {mkdtemp, realpath, lstat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from '../../server/config.mjs';
import {openCandidateModelProfile, openAccountTransport} from '../../server/provider-profile.mjs';
import {openCandidateModelTransport, availableTextModels, assertModelThread} from '../../server/provider-model.mjs';
import {createProviderToolSession} from '../../server/provider-tools.mjs';
import {probeQualification} from '../../server/provider-isolation.mjs';

const root = await realpath(await mkdtemp(join(tmpdir(), 'benchline-model-profile-probe-')));
const profile = join(root, 'profile'), binary = config.codex;
const report = {at: new Date().toISOString(), qualification: probeQualification, modelTurns: 0, passed: false};
let rpc, definitions;
try {
  await assert.rejects(openCandidateModelTransport({binary, root: profile, model: 'unselected-fixture'}), /Sign in explicitly/);
  report.signedOutRefused = true;
  const opened = await openCandidateModelProfile({binary, root: profile}); rpc = opened.rpc;
  report.catalogue = await availableTextModels(rpc);
  const defaults = report.catalogue.filter(m => m.isDefault);
  assert.equal(defaults.length, 1, 'Expected one advertised default for a non-generating structural thread');
  const model = defaults[0].model, cwd = opened.cwd;
  const projectId = randomUUID(), documentId = randomUUID(), epoch = randomUUID();
  definitions = await createProviderToolSession({mode: 'discuss', projectId, documentIds: [documentId], threadId: 'schema-only',
    gate: {resolveTarget: async () => ({projectId, documentId, path: join(cwd, 'fixture.txt'), epoch, manifestHash: 'fixture'})}});
  const result = await rpc.request('thread/start', {model, modelProvider: 'openai', cwd, ephemeral: true,
    sandbox: 'read-only', approvalPolicy: 'never', dynamicTools: definitions.tools(),
    developerInstructions: 'Structural qualification only. No model turn will start.',
    allowProviderModelFallback: false, environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [], serviceName: 'benchline'});
  assertModelThread(result, {model, cwd});
  report.thread = {model, ephemeral: result.thread.ephemeral, approvalPolicy: result.approvalPolicy,
    sandbox: result.sandbox, instructionSources: result.instructionSources, runtimeWorkspaceRoots: result.runtimeWorkspaceRoots};
  await definitions.close(); await rpc.close();
  rpc = await openAccountTransport({binary, root: profile});
  assert.equal((await rpc.request('account/read', {refreshToken: false})).account, null);
  report.accountSetupReusable = true; await rpc.close();
  for (const name of ['account-process.lock', 'codex/auth.json']) {
    await assert.rejects(lstat(join(profile, name)), e => e.code === 'ENOENT');
  }
  report.lockAndAuthAbsent = true;
  report.limitations = ['No authenticated model/tool inventory qualification', 'No model turn or positive agent/UI/native journey',
    'Structural default model is not a production model selection', 'Production modes remain disabled'];
  report.passed = true;
} finally {await definitions?.close(); await rpc?.close();}
const receipt = join(root, 'receipt.json');
await writeFile(receipt, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({...report, receipt}, null, 2));
