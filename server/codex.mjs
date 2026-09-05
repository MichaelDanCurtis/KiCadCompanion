import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { config } from './config.mjs';

export class CodexAgent {
  constructor({ cwd, url, token, toolPath, onEvent, onRequest, onStatus }) {
    Object.assign(this, { cwd, url, token, toolPath, onEvent, onRequest, onStatus });
    this.pending = new Map(); this.next = 0;
  }
  async connect() {
    const binary = config.codex;
    // Only this app's two MCP servers are enabled in this process; global settings are untouched.
    const { stdout } = await promisify(execFile)(binary, ['mcp', 'list', '--json'], { maxBuffer: 4e6 });
    const entries = JSON.parse(stdout);
    const args = ['app-server'];
    for (const entry of entries) {
      const transport = entry.transport;
      args.push('-c', `mcp_servers.${entry.name}.enabled=false`);
      // Desktop-supplied definitions can be absent at app-server initialization,
      // then reappear when a thread loads. Preserve each original transport type.
      const field = transport.type === 'streamable_http' ? 'url' : 'command';
      args.push('-c', `mcp_servers.${entry.name}.${field}=${JSON.stringify(transport[field])}`);
    }
    args.push('-c', `mcp_servers.konnect={command=${JSON.stringify(process.env.KONNECT_BIN || entries.find(e => e.name === 'konnect')?.transport.command || config.konnect)},enabled=true,required=true}`);
    for (const key of ['KICAD_API_SOCKET', 'KICAD_API_TOKEN']) {
      if (process.env[key]) args.push('-c', `mcp_servers.konnect.env.${key}=${JSON.stringify(process.env[key])}`);
    }
    args.push('-c', `mcp_servers.companion.command=${JSON.stringify(process.execPath)}`,
      '-c', `mcp_servers.companion.args=${JSON.stringify([this.toolPath])}`,
      '-c', `mcp_servers.companion.env=${JSON.stringify({COMPANION_URL:this.url,COMPANION_TOKEN:this.token}).replace(/"([^"\\]+)":/g, '"$1"=')}`);
    this.process = spawn(binary, args, { cwd: this.cwd, stdio: ['pipe','pipe','pipe'], env: process.env });
    let stderr = '';
    this.process.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-4000); });
    this.process.on('error', e => this.fail(e));
    this.process.on('exit', code => this.fail(new Error(`Codex stopped (${code}). ${stderr.replaceAll(this.token, '[redacted]')}`)));
    createInterface({ input: this.process.stdout }).on('line', line => {
      try { this.receive(JSON.parse(line)); } catch { /* non-protocol diagnostics are not chat */ }
    });
    await this.request('initialize', { clientInfo: { name: 'kicad_companion', version: '0.1.0' } });
    this.send({ method: 'initialized' });
    const account = await this.request('account/read', {});
    const capabilities = await this.request('modelProvider/capabilities/read', {}).catch(() => ({}));
    this.onStatus({ connected: true, signedIn: Boolean(account.account), authType: account.account?.type || null, imageGeneration: capabilities.imageGeneration === true });
  }
  send(message) { this.process.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  receive(message) {
    if (message.method) {
      if (message.id !== undefined) this.onRequest(message);
      else this.onEvent(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
  }
  respond(id, result) { this.send({ id, result }); }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.onStatus({ connected: false, error: error.message });
  }
  close() { this.process?.kill(); }
}
