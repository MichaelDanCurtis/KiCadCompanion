// Actual qualification HTTP/Vite process, but no signed-in profile or model turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, realpath, readFile, mkdir, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

test('authenticated UI entry is inert and serves real components without runtime files', {timeout: 15000}, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'benchline-auth-http-')));
  await writeFile(join(root, 'owner.json'), '{}');
  await mkdir('.runtime', {recursive: true});
  const sentinel = resolve('.runtime', `auth-ui-http-${randomUUID()}.txt`), marker = randomUUID();
  await writeFile(sentinel, marker, {flag: 'wx', mode: 0o600});
  t.after(() => unlink(sentinel));
  const child = spawn(process.execPath, ['tests/fixtures/authenticated-product-approval-ui.mjs',
    '--serve-authenticated-fixture', '--account-root', root, '--binary', '/nonexistent/no-model-may-start',
    '--use-advertised-default', '--run-one-turn', '--code-mode-candidate', '--approval-once'],
  {stdio: ['ignore', 'pipe', 'pipe']});
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({code, signal})));
  t.after(async () => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited;});
  child.stderr.on('data', () => {});
  const address = await new Promise((resolve, reject) => {
    let text = '', received = 0, ready = false;
    const timeout = setTimeout(() => reject(Error('Qualification server did not start')), 8000);
    child.once('error', error => {clearTimeout(timeout); reject(error);});
    child.once('close', () => {clearTimeout(timeout); reject(Error('Qualification server exited before readiness'));});
    child.stdout.on('data', data => {
      if (ready) return;
      received += data.length;
      if (received > 65536) {clearTimeout(timeout); reject(Error('Qualification startup output limit')); return;}
      text += data;
      // Vite may print a dependency-cache refresh before the readiness record
      // after a lockfile change. Only this explicit fixture record is readiness.
      let end;
      while ((end = text.indexOf('\n')) >= 0) {
        const line = text.slice(0, end); text = text.slice(end + 1);
        if (!line.startsWith('{')) continue;
        try {
          const value = JSON.parse(line);
          if (value.authenticatedCandidate !== true || value.productionEnabled !== false) continue;
          assert.match(value.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
          assert.equal(typeof value.evidence, 'string');
          clearTimeout(timeout); ready = true; resolve(value); return;
        } catch (error) {clearTimeout(timeout); reject(error); return;}
      }
    });
  });
  const request = (path, options) => fetch(address.origin + path, options);
  const project = await (await request('/fixture/project')).json();
  assert.match(project.fixtureNote, /Real signed-in model candidate/);
  assert.match(project.fixturePrompt, /benchline_prepare_action/);
  const html = await (await request('/')).text(); assert.match(html, /TEST ONLY/);
  const component = await request('/tests/fixtures/product-approval-ui.jsx');
  assert.equal(component.status, 200); const compiled = await component.text();
  assert.match(compiled, /fixtureNote/); assert.match(compiled, /initialDraft/);
  for (const path of ['/src/product-agent.jsx', '/src/action-controls.jsx']) assert.equal((await request(path)).status, 200);
  const capabilities = await (await request('/api/provider/product/capabilities')).json();
  assert.equal(capabilities.modes.agent.supported, true); assert.equal(capabilities.modes.discuss.supported, false);
  assert.equal((await request('/fixture/project', {headers: {Origin: 'https://foreign.invalid'}})).status, 403);
  for (const path of ['/api/actions/prepare', `/api/actions/${randomUUID()}/execute`]) {
    assert.equal((await request(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 403);
  }
  for (const path of [`/.runtime/${sentinel.split('/').at(-1)}`, `/@fs${sentinel}`]) {
    const response = await request(path); assert.ok([403, 404].includes(response.status));
    assert.ok(!(await response.text()).includes(marker));
  }
  const evidence = await (await request('/fixture/evidence')).json();
  assert.equal(evidence.profileAttempts, 0); assert.equal(evidence.turnAttempts, 0);
  assert.equal(evidence.dispatches, 0); assert.equal(evidence.modelUsed, false); assert.equal(evidence.passed, false);
  child.kill('SIGTERM'); assert.deepEqual(await exited, {code: 0, signal: null});
  const saved = JSON.parse(await readFile(address.evidence, 'utf8'));
  assert.equal(saved.profileAttempts, 0); assert.equal(saved.turnAttempts, 0); assert.equal(saved.browserVerified, false);
});
