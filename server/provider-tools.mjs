import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {digest} from './actions.mjs';
import {targetSchema} from '../shared/actions.mjs';

const identifier = z.string().min(1).max(200);
const prepareArgs = z.object({
  documentId: z.string().uuid(),
  adapter: z.string().min(1).max(80),
  operation: z.string().min(1).max(80),
  args: z.record(z.unknown()),
}).strict();
const actionArgs = z.object({actionId: z.string().uuid()}).strict();
const requestSchema = z.object({
  id: z.union([z.string().min(1).max(200), z.number().int().safe()]),
  method: z.literal('item/tool/call'),
  params: z.object({
    threadId: identifier, turnId: identifier, callId: identifier,
    namespace: z.null().optional(),
    tool: z.enum(['benchline_prepare_action', 'benchline_action_status', 'benchline_execute_action']),
    arguments: z.unknown(),
  }).strict(),
}).strict();
const response = (value, success = true) => ({
  success, contentItems: [{type: 'inputText', text: JSON.stringify(value)}],
});
const denied = () => response({error: {
  code: 'denied', message: 'Tool request denied. Review the action in Benchline; do not retry a mutation blindly.',
}}, false);
const assert = condition => { if (!condition) throw Error('Provider scope rejected'); };

function view(action, gate) {
  // Do not return raw receipts, recovery data, paths, exception text or grants.
  // Only a separately reviewed, schema-bounded adapter projection may leave.
  return {
    actionId: action.id, documentId: action.input.documentId,
    operation: action.input.operation, state: action.state, effect: action.effect,
    summary: action.preview.summary, revision: action.preview.revision,
    verified: action.state === 'verified',
    needsHumanApproval: action.state === 'awaiting-approval',
    needsReview: ['unknown', 'failed', 'expired'].includes(action.state),
    result: gate.providerResult?.(action.id) ?? {status: 'unsupported'},
  };
}

/** Host-only factory; never expose this or the ActionGate over a provider tool.
 * This mediates callbacks. It does not sandbox Codex or disable its other tools.
 * The production provider must remain disabled until isolation is verified.
 */
export async function createProviderToolSession({gate, threadId, mode, projectId, documentIds, waitForApproval = false}) {
  identifier.parse(threadId);
  z.enum(['discuss', 'agent']).parse(mode);
  z.boolean().parse(waitForApproval);
  z.string().uuid().parse(projectId);
  const documents = z.array(z.string().uuid()).min(1).max(100).parse(documentIds);
  assert(new Set(documents).size === documents.length);
  const targets = new Map();
  for (const documentId of documents) {
    const target = targetSchema.parse(await gate.resolveTarget({projectId, documentId}));
    assert(target.projectId === projectId && target.documentId === documentId);
    targets.set(documentId, structuredClone(target));
  }
  // Binding lives in a closure: model arguments cannot overwrite host authority.
  let activeTurn = null, closed = false, approvalWait = null;
  const seenTurns = new Set(), calls = new Map(), owned = new Map();
  const current = turnId => assert(!closed && activeTurn === turnId);
  const sameTarget = action => assert(digest(action.target) === digest(targets.get(action.input.documentId)));
  const getOwned = (id, turnId) => {
    assert(owned.get(id) === turnId);
    const action = gate.get(id);
    assert(action.input.projectId === projectId && action.input.mode === mode);
    sameTarget(action);
    return action;
  };
  const stopActions = turnId => Promise.all([...owned].filter(([, turn]) => turn === turnId)
    .map(([id]) => gate.cancel(id)));

  async function dispatch(p) {
    current(p.turnId);
    if (p.tool === 'benchline_prepare_action') {
      const args = prepareArgs.parse(p.arguments);
      assert(targets.has(args.documentId));
      const target = await gate.resolveTarget({projectId, documentId: args.documentId});
      current(p.turnId);
      assert(digest(target) === digest(targets.get(args.documentId)));
      const action = await gate.prepare({
        ...args, projectId, mode, idempotencyKey: randomUUID(),
      });
      owned.set(action.id, p.turnId);
      // Ending a turn during asynchronous prepare must not leave a usable action.
      try { current(p.turnId); sameTarget(action); }
      catch (error) { await gate.cancel(action.id); throw error; }
      if (waitForApproval && action.state === 'awaiting-approval') {
        const decided = await gate.waitForDecision(action.id, {signal: approvalWait.signal});
        try {
          current(p.turnId);
          assert(digest(await gate.resolveTarget({projectId, documentId: args.documentId})) === digest(targets.get(args.documentId)));
          current(p.turnId);
        } catch (error) {await gate.cancel(action.id); throw error;}
        return response(view(decided, gate));
      }
      return response(view(action, gate));
    }
    const {actionId} = actionArgs.parse(p.arguments);
    const action = getOwned(actionId, p.turnId);
    if (p.tool === 'benchline_action_status') return response(view(action, gate));
    // Approval decisions are exclusively host/UI calls to the gate. There is
    // deliberately no decide, grant, revoke, inspect, shell or arbitrary MCP tool.
    const result = await gate.execute(actionId);
    current(p.turnId);
    return response(view(result, gate), !['unknown', 'failed', 'declined', 'cancelled', 'expired'].includes(result.state));
  }

  return Object.freeze({
    tools() {
      return [
        {type: 'function', name: 'benchline_prepare_action',
          description: 'Propose a registered action for the selected document. This does not execute it or grant permission. Review pending actions in Benchline.'
            + (waitForApproval ? ' This call waits for the human decision or preview expiry. Execute only a ready or approved action.' : ''),
          inputSchema: {type: 'object', additionalProperties: false,
            properties: {documentId: {type: 'string', enum: [...documents]}, adapter: {type: 'string'}, operation: {type: 'string'}, args: {type: 'object', properties: {}}},
            required: ['documentId', 'adapter', 'operation', 'args']}},
        ...['benchline_action_status', 'benchline_execute_action'].map(name => ({
          type: 'function', name,
          description: name.endsWith('status') ? 'Read the status of an action proposed in this active turn.'
            : 'Request execution of this turn\'s action. The host enforces approval, scope, revision and replay checks. This cannot approve an action.',
          inputSchema: {type: 'object', additionalProperties: false,
            // Codex strips JSON Schema format. UUID validation remains mandatory
            // in actionArgs above; expose the exact provider-supported schema.
            properties: {actionId: {type: 'string'}}, required: ['actionId']},
        })),
      ];
    },
    beginTurn(turnId) {
      identifier.parse(turnId);
      assert(!closed && activeTurn === null && !seenTurns.has(turnId) && seenTurns.size < 1000);
      activeTurn = turnId; seenTurns.add(turnId);
      approvalWait = new AbortController();
    },
    endTurn(turnId) {
      current(turnId);
      activeTurn = null; // Synchronous invalidation precedes queued cancellation.
      approvalWait?.abort();
      return stopActions(turnId);
    },
    close() {
      closed = true;
      const turn = activeTurn; activeTurn = null;
      approvalWait?.abort();
      return stopActions(turn);
    },
    handleEvent(message) {
      // Notifications can invalidate authority, never create/expand it. The host
      // still calls beginTurn with the ID accepted by turn/start.
      const p = message?.params;
      if (message?.method === 'turn/completed' && p?.threadId === threadId && activeTurn !== null && p?.turn?.id === activeTurn) {
        const turn = activeTurn; activeTurn = null;
        approvalWait?.abort();
        return stopActions(turn);
      }
      if (['thread/closed', 'thread/archived'].includes(message?.method) && p?.threadId === threadId) {
        closed = true;
        const turn = activeTurn; activeTurn = null;
        approvalWait?.abort();
        return stopActions(turn);
      }
      return Promise.resolve();
    },
    async handle(raw) {
      try {
        assert(JSON.stringify(raw).length <= 32768);
        const {params: p} = requestSchema.parse(raw);
        assert(p.threadId === threadId); current(p.turnId);
        // A retransmission shares one promise even while prepare is awaiting I/O.
        // The transport request ID may change, but call identity/arguments may not.
        const key = JSON.stringify([p.turnId, p.callId]), fingerprint = digest(p);
        const prior = calls.get(key);
        if (prior) {
          assert(prior.fingerprint === fingerprint);
          const result = await prior.result; current(p.turnId);
          return structuredClone(result);
        }
        assert(calls.size < 1000);
        const result = dispatch(p).catch(() => denied());
        calls.set(key, {fingerprint, result});
        const value = await result; current(p.turnId);
        return structuredClone(value);
      } catch { return denied(); }
    },
  });
}
