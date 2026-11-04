// The caller owns this process for the lifetime of one candidate profile.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {sha256} from './provider-isolation.mjs';
import {startCodeModeGateway} from './code-mode-gateway.mjs';

export const codeModeHostSha256 = 'fdd977821def000939dd48da48b39d581845470671135bd4642584eeb0762a6b';

// Keep process ownership cleanup independent of gateway shutdown success. The
// caller must await this before releasing a profile lock or starting a successor.
export async function closeOwnedCodeModeResources({gateway, child, exited, lines}) {
  try {await gateway?.close();} finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2000);
    timer.unref();
    try {await exited;} finally {clearTimeout(timer); lines.close();}
  }
}

export async function ownedCodeModeGateway({binary, cwd, env}) {
  assert.equal(sha256(await readFile(binary)), codeModeHostSha256);
  const child = spawn(binary, ['--listen', 'grpc://127.0.0.1:0'], {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({code, signal})));
  child.stderr.resume();
  const lines = createInterface({input: child.stdout});
  let gateway, closing;
  const close = () => closing ||= closeOwnedCodeModeResources({gateway, child, exited, lines});
  try {
    const upstreamUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Code Mode host startup timed out')), 5000);
      lines.once('line', line => {clearTimeout(timer); resolve(line);});
      child.once('error', error => {clearTimeout(timer); reject(error);});
      child.once('exit', () => {clearTimeout(timer); reject(Error('Code Mode host exited before readiness'));});
    });
    gateway = await startCodeModeGateway({upstreamUrl});
    return {url: gateway.url, evidence: gateway.evidence, closed: exited, close};
  } catch (error) {await close(); throw error;}
}
