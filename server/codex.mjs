import {StringDecoder} from 'node:string_decoder';
import {requireProviderMode} from './provider-boundary.mjs';

// Host-only protocol surface. Model callbacks cannot choose RPC methods. In
// particular process/spawn, fs/*, shell, config writes and thread/resume are absent.
const methods = new Set(['initialize', 'config/read', 'account/read', 'model/list',
  'modelProvider/capabilities/read', 'thread/start', 'turn/start', 'turn/interrupt']);
const accountMethods = new Set(['initialize', 'config/read', 'account/read', 'account/login/start', 'account/login/cancel', 'account/logout']);
const transportError = () => Error('Provider transport failed; inspect the action journal before retrying');
export class CodexAgent {
  #accountOnly;
  constructor({onEvent = () => {}, onStatus = () => {}, toolSession = null, accountOnly = false} = {}) {
    this.#accountOnly = accountOnly === true;
    Object.assign(this, {onEvent, onStatus, toolSession});
    this.pending = new Map(); this.next = 0; this.closed = false; this.incoming = 0;
  }
  async connect() {
    requireProviderMode('agent');
    // The old inherited-profile/direct-Konnect launcher has been removed. Merely
    // changing the feature guard cannot restore it. A reviewed production profile
    // and explicit account setup must supply a qualified child via attach().
    throw Error('No qualified production provider launch profile is configured');
  }
  attach(child) {
    if (this.process || this.closed || !child?.stdin || !child.stdout || !child.stderr) throw transportError();
    this.process = child;
    let buffer = ''; const decoder = new StringDecoder('utf8');
    child.stdout.on('data', chunk => {
      if (this.closed) return;
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) {this.fail(); return;}
      let end;
      while (!this.closed && (end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {Promise.resolve(this.receive(JSON.parse(line))).catch(() => this.fail());}
        catch {this.fail();}
      }
    });
    child.stdout.on('error', () => this.fail());
    child.stdin.on('error', () => this.fail());
    child.stderr.on('data', () => {}); // No credentials or raw diagnostics in UI errors.
    child.on('error', () => this.fail());
    child.on('exit', () => {if (!this.closed) this.fail();});
    return this;
  }
  send(message) {
    if (this.closed || !this.process?.stdin.writable) throw transportError();
    const data = JSON.stringify(message);
    if (Buffer.byteLength(data) > 1024 * 1024) throw transportError();
    this.process.stdin.write(data + '\n');
  }
  request(method, params, timeout = 30000) {
    if (this.closed || !(this.#accountOnly ? accountMethods : methods).has(method) || this.pending.size >= 128 ||
        !Number.isInteger(timeout) || timeout < 1 || timeout > 60000) return Promise.reject(transportError());
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => this.fail(), timeout);
      this.pending.set(id, {resolve, reject, timer});
      try {this.send({id, method, params});} catch {this.fail();}
    });
  }
  receive(message) {
    if (this.closed) return;
    if (!message || typeof message !== 'object' || Array.isArray(message)) {this.fail(); return;}
    if (message.method) {
      if (message.id !== undefined) {
        // No legacy approval fallback, even if no project session is attached.
        if (this.#accountOnly || message.method !== 'item/tool/call' || !this.toolSession) {
          this.send({id: message.id, error: {code: -32601, message: 'Only mediated Benchline tools are supported'}});
          return;
        }
        if (++this.incoming > 32) {this.fail(); return;}
        return Promise.resolve().then(() => this.toolSession.handle(message))
          .then(result => {if (!this.closed) this.respond(message.id, result);})
          .catch(() => this.fail()).finally(() => this.incoming--);
      }
      const lifecycle = this.toolSession?.handleEvent(message);
      this.onEvent(message);
      return lifecycle?.catch(() => this.fail());
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    if (message.error) pending.reject(Error('Provider rejected the request'));
    else pending.resolve(message.result);
  }
  respond(id, result) {this.send({id, result});}
  fail() {
    if (this.closed) return;
    this.close().catch(() => {});
    this.onStatus({connected: false, error: transportError().message});
  }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    let resolve, reject;
    this.closing = new Promise((yes, no) => {resolve = yes; reject = no;});
    // Session.close invalidates synchronously, before process termination or I/O.
    let cleanup;
    try {cleanup = this.toolSession?.close();} catch (error) {cleanup = Promise.reject(error);}
    for (const p of this.pending.values()) {clearTimeout(p.timer); p.reject(transportError());}
    this.pending.clear();
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
      const child = this.process; child.kill('SIGTERM');
      const timer = setTimeout(() => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');}, 2000);
      timer.unref(); child.once('exit', () => clearTimeout(timer));
    }
    Promise.resolve(cleanup).then(resolve, reject);
    return this.closing;
  }
}
