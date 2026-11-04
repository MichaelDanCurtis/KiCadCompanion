import { spawn, execFileSync } from 'node:child_process';
import { openSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../server/config.mjs';
import { assertInstance, instanceIdentity } from '../server/instance.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localKonnect = join(homedir(), '.local/bin/konnect');
if (!process.env.KONNECT_BIN && existsSync(localKonnect)) process.env.KONNECT_BIN = localKonnect;
const url = `http://127.0.0.1:${config.port}`;
async function ready() {
  let response;
  try {response=await fetch(`${url}/api/state`,{signal:AbortSignal.timeout(1200)})}catch{return false}
  let state;try{state=await response.json()}catch{throw new Error('Port is occupied by another service. Choose another BENCHLINE_PORT.')}
  if(!response.ok)throw new Error('Port is occupied by another service. Choose another BENCHLINE_PORT.');
  assertInstance(state,instanceIdentity(config,root));
  return true;
}
if (!await ready()) {
  mkdirSync(config.runtime, {recursive:true});
  const log = openSync(join(config.runtime, 'server.log'), 'a',0o600);
  const child = spawn(process.execPath, [join(root, 'server/index.mjs')], { cwd:root, detached:true, stdio:['ignore',log,log], env:process.env });
  child.unref();
  let started = false;
  for (let i=0;i<40;i++) { if(await ready()){started=true;break;} await new Promise(r=>setTimeout(r,250)); }
  if (!started) throw new Error(`Benchline did not start; inspect ${join(config.runtime,'server.log')}`);
}
const bundle = join(root, '.runtime/Benchline.app');
if (process.argv.includes('--server-only')) console.log(url);
else if (process.platform === 'darwin' && existsSync(bundle)) execFileSync('open', ['-na', bundle, '--args', url]);
else if (process.platform === 'darwin') execFileSync('open', [url]);
else console.log(`Open ${url} in a browser`);
