import {z} from 'zod';
import {openAccountTransport} from './provider-profile.mjs';

const loginId = z.string().uuid();
export function managedLogin(value) {
  const parsed = z.object({type: z.literal('chatgpt'), loginId, authUrl: z.string().max(12000)}).strict().parse(value);
  const url = new URL(parsed.authUrl);
  if (url.protocol !== 'https:' || !['chatgpt.com', 'auth.openai.com'].includes(url.hostname) ||
      url.port || url.username || url.password || url.hash) throw Error('Unexpected sign-in destination');
  return parsed;
}
const accountView = value => {
  if (!value || typeof value.requiresOpenaiAuth !== 'boolean') throw Error('Invalid account status');
  if (value.account !== null && (!value.account || typeof value.account !== 'object' ||
      Array.isArray(value.account) || typeof value.account.type !== 'string')) throw Error('Invalid account status');
  const type = value.account === null ? null : value.account.type;
  if (type !== null && type !== 'chatgpt') throw Error('Only managed ChatGPT sign-in is supported in this profile');
  return {signedIn: type === 'chatgpt', authType: type}; // Never expose email/tokens or raw account payload.
};
const failure = () => Error('Isolated Codex account setup failed. Existing credentials were not imported; inspect setup before retrying.');

/** Account ceremony only: no gate, model session, arbitrary provider RPC, API key
 * ingestion or credential-copy endpoint. login() is an explicit user UI action.
 */
export class ProviderAccount {
  #open; #rpc = null; #generation = 0; #busy = false; #pending = null; #events = []; #loginStarting = false;
  #closing = null;
  #state = {phase: 'disconnected', signedIn: null, authType: null, modelExecutionEnabled: false};
  constructor({binary, root, open = openAccountTransport}) {this.#open = callbacks => open({binary, root, ...callbacks});}
  status() {return {...this.#state, busy: this.#busy, loginPending: Boolean(this.#pending)};}
  async #run(action) {
    if (this.#busy) throw Error('An account operation is already running');
    this.#busy = true;
    try {const result = await action(); return Object.hasOwn(result, 'busy') ? {...result, busy: false} : result;}
    catch {
      // Cleanup failures remain latched by disconnect(), but must not replace
      // the public error with paths or other private transport details.
      try {await this.disconnect();} catch {}
      this.#state.phase = 'error'; throw failure();
    }
    finally {this.#busy = false;}
  }
  async connect() {
    return this.#run(async () => {
      if (this.#rpc) return this.status();
      const generation = ++this.#generation; this.#state.phase = 'connecting';
      // Another HTTP caller may have disconnected while transport shutdown was
      // still releasing the exclusive profile lock. Do not reopen ahead of it.
      await this.#closing;
      if (generation !== this.#generation) throw failure();
      const rpc = await this.#open({onEvent: event => this.#receive(event, generation),
        onStatus: status => {if (generation === this.#generation && !status.connected) this.disconnect().catch(() => {});}});
      if (generation !== this.#generation) {await rpc.close(); throw failure();}
      this.#rpc = rpc;
      const account = accountView(await rpc.request('account/read', {refreshToken: false}));
      if (generation !== this.#generation) throw failure();
      this.#state = {...this.#state, ...account, phase: 'ready'}; return this.status();
    });
  }
  async refresh() {
    return this.#run(async () => {
      if (!this.#rpc) throw failure();
      const generation = this.#generation;
      const account = accountView(await this.#rpc.request('account/read', {refreshToken: false}));
      if (generation !== this.#generation) throw failure();
      this.#state = {...this.#state, ...account, phase: 'ready'}; return this.status();
    });
  }
  async login() {
    return this.#run(async () => {
      if (!this.#rpc || this.#pending || this.#state.signedIn) throw failure();
      const generation = this.#generation; this.#events = []; this.#loginStarting = true; this.#state.phase = 'starting-login';
      const result = managedLogin(await this.#rpc.request('account/login/start', {type: 'chatgpt'}));
      if (generation !== this.#generation) throw failure();
      this.#pending = result.loginId; this.#loginStarting = false; this.#state.phase = 'awaiting-sign-in';
      // An early completion is not evidence of login. It invalidates cached
      // status and requires a fresh account/read, just like a later completion.
      for (const event of this.#events) this.#receive(event, generation);
      this.#events = [];
      // URL is returned once to the explicit caller; never saved in status/logs.
      return {...result, modelExecutionEnabled: false};
    });
  }
  #receive(message, generation) {
    if (generation !== this.#generation) return;
    if (this.#loginStarting && ['account/login/completed', 'account/updated'].includes(message?.method)) {
      if (this.#events.length >= 8) {this.disconnect().catch(() => {}); return;}
      this.#events.push(message); return;
    }
    if (message?.method === 'account/login/completed') {
      if (message.params?.loginId !== this.#pending || !this.#pending) return;
      this.#pending = null;
      this.#state = {...this.#state, signedIn: null, authType: null,
        phase: message.params.success === true ? 'refresh-required' : 'login-failed'};
    } else if (message?.method === 'account/updated') {
      this.#state = {...this.#state, signedIn: null, authType: null, phase: 'refresh-required'};
    }
  }
  async cancelLogin() {
    return this.#run(async () => {
      if (!this.#rpc || !this.#pending) throw failure();
      const generation = this.#generation, id = this.#pending; this.#pending = null;
      await this.#rpc.request('account/login/cancel', {loginId: id});
      if (generation !== this.#generation) throw failure();
      this.#state = {...this.#state, signedIn: null, authType: null, phase: 'refresh-required'};
      return this.status();
    });
  }
  async logout() {
    return this.#run(async () => {
      if (!this.#rpc) throw failure();
      const generation = this.#generation;
      await this.#rpc.request('account/logout', {}); this.#pending = null;
      const account = accountView(await this.#rpc.request('account/read', {refreshToken: false}));
      if (generation !== this.#generation || account.signedIn) throw failure();
      this.#state = {...this.#state, ...account, phase: 'ready'}; return this.status();
    });
  }
  async disconnect() {
    ++this.#generation; this.#pending = null; this.#events = []; this.#loginStarting = false;
    const rpc = this.#rpc; this.#rpc = null;
    this.#state = {phase: 'disconnected', signedIn: null, authType: null, modelExecutionEnabled: false};
    // Every disconnect caller waits for the same actual shutdown. A rejected
    // close remains latched: failure to release ownership must not be ignored.
    try {
      if (rpc) {
        const closing = Promise.resolve().then(() => rpc.close());
        this.#closing = closing;
        await closing;
        if (this.#closing === closing) this.#closing = null;
      } else await this.#closing;
    } catch {
      // Do not clear rejected ownership cleanup or allow another opener.
      this.#state.phase = 'error'; throw failure();
    }
    // Closing this process does not log out or erase files.
  }
}
