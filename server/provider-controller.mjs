import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {providerBoundary, requireProviderMode} from './provider-boundary.mjs';
import {MediatedProviderSession} from './provider-session.mjs';

const selectionSchema = z.object({projectId: z.string().uuid(),
  documentIds: z.array(z.string().uuid()).min(1).max(100), mode: z.enum(['discuss', 'agent']),
  expectedManifestHash: z.string().min(1).max(200), expectedEpoch: z.string().uuid()}).strict();
const stale = () => Object.assign(Error('Agent selection changed; refresh the selected product before continuing.'), {status: 409});
const notQualified = () => {throw Object.assign(Error('No qualified production model transport is available.'), {status: 422});};

/** Host/UI ownership boundary above a mediated thread. It is never a model tool.
 * No profile path, RPC method, permission decision or resume ID is client supplied.
 * openTransport is a trusted host dependency, not configurable through HTTP.
 */
export class ProductProviderController {
  #gate; #open; #requireMode; #boundary; #generation = 0; #session = null; #transport = null; #selectionId = null;
  #scope = null; #phase = 'disconnected'; #closing = Promise.resolve();
  #opening = null;
  #messages = []; #characters = 0;
  constructor({gate, openTransport = notQualified, requireMode = requireProviderMode, boundary = providerBoundary}) {
    this.#gate = gate; this.#open = openTransport; this.#requireMode = requireMode;
    this.#boundary = structuredClone(boundary);
  }
  capabilities() {return structuredClone(this.#boundary);}
  status() {
    return {selectionId: this.#selectionId, scope: this.#scope && structuredClone(this.#scope),
      phase: this.#session?.snapshot().phase ?? this.#phase};
  }
  transcript(selectionId) {
    this.#owns(selectionId, false);
    return {selectionId, messages: structuredClone(this.#messages)};
  }
  #message(id, role, text, append = false, turnId) {
    if (typeof id !== 'string' || id.length > 200 || typeof text !== 'string') return;
    let message = this.#messages.find(m => m.id === id && m.role === role && m.turnId === turnId);
    if (!message) {
      if (this.#messages.length >= 100) return;
      message = {id, role, turnId, text: '', truncated: false};
      const assistant = role === 'user' ? this.#messages.findIndex(m => m.turnId === turnId) : -1;
      if (assistant < 0) this.#messages.push(message); else this.#messages.splice(assistant, 0, message);
    }
    const previous = message.text.length;
    const value = append ? message.text + text.slice(0, 32000) : text.slice(0, 32000);
    const available = Math.max(0, Math.min(32000, 200000 - this.#characters + previous));
    message.text = value.slice(0, available);
    message.truncated ||= text.length > 32000 || value.length > available;
    this.#characters += message.text.length - previous;
  }
  #event(message, generation) {
    if (generation !== this.#generation) return;
    const p = message?.params;
    // Only plain assistant text is projected. No raw RPC, tool arguments,
    // diagnostics, login events or receipts become structured chat payloads.
    if (typeof p?.turnId !== 'string') return;
    if (message.method === 'item/agentMessage/delta') this.#message(p.itemId, 'assistant', p.delta, true, p.turnId);
    if (message.method === 'item/completed' && p.item?.type === 'agentMessage') this.#message(p.item.id, 'assistant', p.item.text, false, p.turnId);
  }
  #owns(selectionId, requireSession = true) {
    if (!selectionId || selectionId !== this.#selectionId || (requireSession && !this.#session)) throw stale();
    return this.#session;
  }
  #revoke() {
    ++this.#generation;
    const session = this.#session, transport = this.#transport, opening = this.#opening;
    this.#session = null; this.#transport = null; this.#opening = null;
    this.#selectionId = null; this.#scope = null; this.#phase = 'disconnected';
    this.#messages = []; this.#characters = 0;
    // close() invalidates callbacks synchronously, even while cleanup is pending.
    const close = session?.close();
    // Transport-initiated failure already sets rpc.closed before its process
    // exits. Session cleanup avoids recursion; this owner still awaits exit.
    const transportClose = transport?.close();
    opening?.abort.abort();
    const openingClose = opening?.rpc?.close();
    // Await even a late/uncooperative opener. Never overlap process owners or
    // report shutdown complete solely because callback authority was revoked.
    this.#closing = Promise.allSettled([this.#closing, close, transportClose, openingClose, opening?.done]).then(results => {
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    });
    return this.#closing;
  }
  async select(input, {signal} = {}) {
    const selected = selectionSchema.parse(input);
    if (new Set(selected.documentIds).size !== selected.documentIds.length) throw stale();
    const closing = this.#revoke(), generation = this.#generation;
    let settle;
    const opening = {abort: new AbortController(), rpc: null, done: new Promise(resolve => {settle = resolve;})};
    this.#opening = opening;
    const scope = {projectId: selected.projectId, documentIds: selected.documentIds, mode: selected.mode};
    this.#selectionId = randomUUID(); this.#scope = scope;
    this.#phase = 'opening';
    const abort = () => {if (generation === this.#generation) this.close().catch(() => {});};
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    let rpc, session;
    try {
      await closing;
      if (generation !== this.#generation) throw stale();
      this.#requireMode(selected.mode);
      for (const documentId of selected.documentIds) {
        const target = await this.#gate.resolveTarget({projectId: selected.projectId, documentId});
        if (generation !== this.#generation || target.projectId !== selected.projectId || target.documentId !== documentId ||
            target.manifestHash !== selected.expectedManifestHash || target.epoch !== selected.expectedEpoch) throw stale();
      }
      rpc = await this.#open({signal: opening.abort.signal}); opening.rpc = rpc;
      if (generation !== this.#generation) throw stale();
      session = await MediatedProviderSession.open({rpc, gate: this.#gate, scope, waitForApproval: true, onEvent: event => this.#event(event, generation)});
      // Opening the process/thread can take time. Recheck the UI's revision, not
      // merely the session's later snapshot, before accepting this selection.
      for (const documentId of selected.documentIds) {
        const target = await this.#gate.resolveTarget({projectId: selected.projectId, documentId});
        if (target.manifestHash !== selected.expectedManifestHash || target.epoch !== selected.expectedEpoch ||
            target.projectId !== selected.projectId || target.documentId !== documentId) throw stale();
      }
      if (generation !== this.#generation) throw stale();
      this.#session = session; this.#transport = rpc; this.#phase = 'ready';
      return this.status();
    } catch (error) {
      // A transport may already be invalidated while its process/profile still
      // closes. Session.close avoids reciprocal transport waits in that case,
      // so the opening owner must await both before releasing opening.done.
      const cleanup = await Promise.allSettled([session?.close(), rpc?.close()]);
      const cleanupFailure = cleanup.find(result => result.status === 'rejected');
      if (cleanupFailure) {
        // Preserve failed ownership cleanup for shutdown/reopen refusal, but do
        // not let private transport diagnostics bypass the API mapping below.
        this.#closing = this.#closing.then(() => {throw cleanupFailure.reason;});
        this.#closing.catch(() => {});
      }
      if (generation === this.#generation) {
        this.#phase = error.status === 422 ? 'unsupported' : 'error';
        this.#selectionId = null; this.#scope = null;
      }
      // Runtime errors can contain private provider data. Only our scoped host
      // errors are returned verbatim; no raw exception is sent to the UI.
      if (error.status === 409 || opening.abort.signal.aborted) throw stale();
      if (error.status === 422) throw Object.assign(Error('Selected provider mode or model transport is not qualified.'), {status: 422});
      throw Object.assign(Error('Product agent setup failed; no session was activated.'), {status: 503});
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.#opening === opening) this.#opening = null;
      settle();
    }
  }
  async startTurn(selectionId, text) {
    const session = this.#owns(selectionId);
    const value = z.string().trim().min(1).max(16000).parse(text);
    if (this.#messages.length >= 99 || this.#characters + value.length > 168000) throw Object.assign(Error('Conversation limit reached; start a fresh scoped session.'), {status: 409});
    const result = await session.startTurn(value);
    if (session !== this.#session || selectionId !== this.#selectionId) throw stale();
    this.#message(`user-${result.turnId}`, 'user', value, false, result.turnId);
    return {...result, selectionId};
  }
  async stop(selectionId) {
    this.#owns(selectionId, false);
    if (this.#opening) {await this.#revoke(); return {closed: true};}
    return this.#owns(selectionId).stop();
  }
  async disconnect(selectionId) {
    // A stale browser tab cannot disconnect a newer tab's selected product.
    this.#owns(selectionId, false); await this.#revoke(); return this.status();
  }
  close() {return this.#revoke();}
}

export function productProviderRoutes(app, controller) {
  const prefix = '/api/provider/product', identity = z.object({selectionId: z.string().uuid()}).strict();
  app.use(prefix, (req, res, next) => {res.set('Cache-Control', 'no-store'); next();});
  app.get(prefix, (req, res) => res.json(controller.status()));
  app.get(`${prefix}/capabilities`, (req, res) => res.json(controller.capabilities()));
  app.get(`${prefix}/transcript/:id`, (req, res) => res.json(controller.transcript(z.string().uuid().parse(req.params.id))));
  app.post(`${prefix}/select`, async (req, res) => {
    const abort = new AbortController();
    const closed = () => {if (!res.writableEnded) abort.abort();};
    res.once('close', closed);
    try {res.json(await controller.select(req.body, {signal: abort.signal}));}
    finally {res.off('close', closed);}
  });
  app.post(`${prefix}/turn`, async (req, res) => {
    const input = identity.extend({text: z.string().trim().min(1).max(16000)}).parse(req.body);
    res.json(await controller.startTurn(input.selectionId, input.text));
  });
  app.post(`${prefix}/stop`, async (req, res) => res.json(await controller.stop(identity.parse(req.body).selectionId)));
  app.post(`${prefix}/disconnect`, async (req, res) => res.json(await controller.disconnect(identity.parse(req.body).selectionId)));
}
