import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));

// Never infer permission from agent prose or remember answers to data-entry/auth forms.
export function approvalScope(request, board, items = new Map()) {
  if (!board) return null;
  const p = request.params || {};
  let label, detail, identity;
  if (request.method === 'mcpServer/elicitation/request') {
    if (p.mode !== 'form' || !p.serverName || !p.message || p.requestedSchema?.type !== 'object'
      || Object.keys(p.requestedSchema.properties || {}).length || p.requestedSchema.required?.length) return null;
    const candidates = [...items.values()].filter(i => i.type === 'mcpToolCall' && i.server === p.serverName
      && i.threadId === p.threadId && i.turnId === p.turnId);
    // A uniquely correlated tool is helpful, but never sufficient: the confirmation
    // text, schema and metadata must also match exactly on every subsequent call.
    if (candidates.length !== 1 || !candidates[0].tool) return null;
    const tool = candidates[0].tool;
    label = `${p.serverName} · ${tool}`;
    detail = 'This same confirmation on this board, including after restart. Different prompts still ask.';
    identity = { server: p.serverName, tool, message: p.message, schema: p.requestedSchema, meta: p._meta ?? null };
  } else if (request.method === 'item/commandExecution/requestApproval') {
    if (!p.command || !p.cwd || p.networkApprovalContext) return null;
    if (p.availableDecisions && !p.availableDecisions.includes('accept')) return null;
    label = `Command · ${p.command}`;
    detail = 'This exact command and working directory on this board. Changed commands or permissions still ask.';
    identity = omit(p, ['threadId', 'turnId', 'itemId', 'approvalId', 'startedAtMs']);
  } else if (request.method === 'item/fileChange/requestApproval') {
    const item = items.get(p.itemId);
    if (!item?.changes?.length) return null;
    label = `File change · ${item.changes.map(c => c.path).join(', ')}`;
    detail = 'This exact proposed patch on this board. Different changes still ask.';
    identity = { request: omit(p, ['threadId', 'turnId', 'itemId', 'startedAtMs']), changes: item.changes };
  } else return null;
  const key = createHash('sha256').update(canonical({ version: 1, method: request.method, board, identity })).digest('hex');
  return { key, board, label, detail };
}

export function approvalResponse(request, decision, content = null) {
  if (!['accept', 'decline', 'cancel', 'always'].includes(decision)) throw new Error('Invalid approval decision');
  const action = decision === 'always' ? 'accept' : decision;
  if (request.method.endsWith('requestApproval')) {
    const available = request.params?.availableDecisions;
    if (available && !available.includes(action)) throw new Error('This decision is not offered by Codex');
    return { decision: action };
  }
  if (request.method === 'mcpServer/elicitation/request') return { action, content: action === 'accept' ? content : null };
  throw new Error('This request is not an approval');
}

export class ApprovalStore {
  constructor(path) {
    this.path = path;
    this.rules = [];
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.rules) || saved.rules.some(r => !/^[a-f0-9]{64}$/.test(r.key)
        || typeof r.board !== 'string' || typeof r.label !== 'string')) throw new Error('Invalid permissions file');
      this.rules = saved.rules;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  list(board) { return this.rules.filter(r => r.board === board); }
  allows(scope) { return Boolean(scope && this.rules.some(r => r.key === scope.key && r.board === scope.board)); }
  save(rules) {
    writeFileSync(this.path + '.tmp', JSON.stringify({ version: 1, rules }, null, 2), { mode: 0o600 });
    renameSync(this.path + '.tmp', this.path);
    this.rules = rules;
  }
  remember(scope) {
    if (!scope) throw new Error('This request cannot be safely remembered');
    if (!this.allows(scope)) this.save([...this.rules, { ...scope, createdAt: new Date().toISOString() }]);
  }
  revoke(key, board) { this.save(this.rules.filter(r => r.key !== key || r.board !== board)); }
}
