// Explicit, credential-free real-process lifecycle qualification. No model
// request, customer document, inherited profile, or native adapter is involved.
import assert from 'node:assert/strict';
import {mkdtemp, realpath, readFile, writeFile, lstat, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../../server/config.mjs';
import {openCandidateSourceDispatchProfile} from '../../server/provider-profile.mjs';
import {sha256} from '../../server/provider-isolation.mjs';
import {sourceDispatchCandidate} from '../../server/provider-dispatch.mjs';
import {ownedCodeModeGateway} from './owned-code-mode-gateway.mjs';

assert.deepEqual(process.argv.slice(2), ['--run']);
const root = await realpath(await mkdtemp(join(tmpdir(), 'benchline-dispatch-lifecycle-')));
const report = {at: new Date().toISOString(), sourceDispatchCandidate, scenarios: [], passed: false};
let activeRpc;
try {
  for (const scenario of ['close', 'abort', 'host-loss', 'dispatcher-loss', 'cleanup-failure']) {
    const profile = join(root, scenario), abort = new AbortController();
    let host;
    const status = [];
    const {rpc, cwd} = await openCandidateSourceDispatchProfile({binary: config.codex, root: profile,
      signal: abort.signal, onStatus: value => status.push(value.connected),
      candidateHostFactory: async options => host = await ownedCodeModeGateway(options)});
    activeRpc = rpc;
    const ownerBefore = sha256(await readFile(join(profile, 'owner.json')));
    const configBefore = sha256(await readFile(join(profile, 'codex/config.toml')));
    await assert.rejects(lstat(join(profile, 'codex/auth.json')), {code: 'ENOENT'});
    if (scenario === 'close') await rpc.close();
    if (scenario === 'abort') abort.abort();
    if (scenario === 'host-loss') await host.close();
    if (scenario === 'dispatcher-loss') assert.equal(rpc.process.kill('SIGKILL'), true);
    if (scenario === 'cleanup-failure') {
      rpc.toolSession = {close() {throw Error('synthetic journal cleanup failure');}};
      // Make an early-release bug deterministic: this owned test child ignores
      // the first termination request, then the transport's bounded kill applies.
      const kill = rpc.process.kill.bind(rpc.process);
      rpc.process.kill = signal => signal === 'SIGTERM' || kill(signal);
      const closing = rpc.close();
      closing.catch(() => {});
      await delay(50);
      assert.ok((await lstat(join(profile, 'account-process.lock'))).isFile());
      await assert.rejects(closing, /synthetic journal cleanup failure/);
      assert.ok(rpc.process.exitCode !== null || rpc.process.signalCode !== null,
        'cleanup rejection must wait for dispatcher termination before unlocking');
    }
    for (let attempt = 0; !rpc.closed && attempt < 100; attempt++) await delay(20);
    assert.equal(rpc.closed, true, `${scenario} must invalidate the RPC transport`);
    if (scenario !== 'cleanup-failure') await rpc.close();
    const terminated = await host.closed;
    assert.ok(terminated.code !== null || terminated.signal !== null);
    await assert.rejects(rpc.request('config/read', {includeLayers: false}));
    await assert.rejects(lstat(join(profile, 'account-process.lock')), {code: 'ENOENT'});
    assert.deepEqual(await readdir(cwd), []);
    assert.equal(sha256(await readFile(join(profile, 'owner.json'))), ownerBefore);
    assert.equal(sha256(await readFile(join(profile, 'codex/config.toml'))), configBefore);
    await assert.rejects(lstat(join(profile, 'codex/auth.json')), {code: 'ENOENT'});
    if (scenario.endsWith('loss')) assert.ok(status.includes(false));
    report.scenarios.push({scenario, transportClosed: true, hostTerminated: true, lockReleased: true,
      workspaceEmpty: true, profileConfigurationUnchanged: true, noAccountCredentials: true});
    activeRpc = null;
  }
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await activeRpc?.close();
  const receipt = join(root, 'receipt.json');
  await writeFile(receipt, JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({...report, receipt}, null, 2));
}
