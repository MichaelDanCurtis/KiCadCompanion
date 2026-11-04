// Explicit qualification harness, never imported by the production server.
// The ordinary product controller and action gate remain the implementation.
import assert from 'node:assert/strict';
import {mkdtemp, realpath, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ActionGate} from '../../server/actions.mjs';
import {FixtureAdapter} from '../../server/adapters/fixture.mjs';
import {openCandidateCodeModeProfile} from '../../server/provider-profile.mjs';
import {smokeOptions} from './provider-authenticated-smoke.mjs';
import {boundedModelController} from './bounded-model-controller.mjs';

export function authenticatedUiOptions(argv) {
  assert.equal(argv[0], '--serve-authenticated-fixture');
  const options = smokeOptions(argv.slice(1));
  assert.equal(options.codeMode, true, 'Explicit Code Mode candidate required');
  assert.equal(options.approvalOnce, true, 'Explicit one-approval scenario required');
  return options;
}

export async function authenticatedProductApproval({root: accountRoot, binary,
  openProfile = openCandidateCodeModeProfile, deadlineMs = 90000}) {
  assert.ok(Number.isInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 90000);
  // Metadata only: do not read, copy, initialize or automatically unlock credentials.
  assert.equal(await realpath(accountRoot), accountRoot);
  assert.ok((await lstat(join(accountRoot, 'owner.json'))).isFile());
  await assert.rejects(lstat(join(accountRoot, 'account-process.lock')), {code: 'ENOENT'});
  const root = await mkdtemp(join(tmpdir(), 'benchline-authenticated-ui-'));
  const scope = {projectId: randomUUID(), documentIds: [randomUUID()], mode: 'agent',
    expectedManifestHash: 'authenticated-ui-fixture', expectedEpoch: randomUUID()};
  const target = {projectId: scope.projectId, documentId: scope.documentIds[0],
    path: join(root, 'nonexistent-fixture.txt'), epoch: scope.expectedEpoch, manifestHash: scope.expectedManifestHash};
  const label = 'Authenticated product UI fixture';
  const prompt = `This is one bounded approval test against an in-memory fixture, not a real board.
Use benchline_prepare_action exactly once with documentId ${target.documentId}, adapter fixture,
operation set-label, args {"value":"${label}"}.
Wait for the separate human decision in Benchline; do not self-approve or ask in chat.
Only if the result is approved, call benchline_execute_action with its actionId exactly once.
On decline, cancellation, expiry or uncertainty, stop without retrying.
Finish with one short sentence distinguishing the human decision from verified execution.
Do not use any other tool.`;
  const adapter = new FixtureAdapter();
  const gate = new ActionGate({path: join(root, 'actions.json'), adapters: new Map([['fixture', adapter]]),
    resolveTarget: async input => {
      assert.equal(input.projectId, target.projectId); assert.equal(input.documentId, target.documentId);
      return structuredClone(target);
    }});
  await gate.init();
  const {controller,report,close}=boundedModelController({gate,root:accountRoot,binary,prompt,
    openProfile,deadlineMs,calls:()=>adapter.calls,expected:{projectId:target.projectId,documentId:target.documentId,
      mode:'agent',adapter:'fixture',operation:'set-label',args:{value:label}}});
  report.fixture=true;
  const evidence = () => ({...structuredClone(report), modelUsed: report.turnAttempts > 0,
    value: adapter.value, dispatches: adapter.calls, journal: gate.list(scope.projectId),
    // Browser inspection is separate evidence; never auto-certify the full journey.
    browserVerified: false, passed: false});
  return {root, scope, target, adapter, gate, controller, prompt, evidence, close};
}
