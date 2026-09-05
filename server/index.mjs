import express from 'express';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Konnect } from './konnect.mjs';
import { CodexAgent } from './codex.mjs';
import { visualMessages } from '../shared/visuals.mjs';
import { ApprovalStore, approvalScope, approvalResponse } from './approvals.mjs';
import { readKiCadAppearance } from './appearance.mjs';
import { RenderStore, fingerprint } from './renders.mjs';
import { config } from './config.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {workspace, runtime} = config;
await mkdir(runtime, { recursive: true });
const port = config.port;
const url = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString('hex');
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (![new URL(url).host, `localhost:${port}`].includes(req.headers.host)) return res.status(403).json({ error: 'Invalid host' });
  if (req.headers.origin && ![url, `http://localhost:${port}`].includes(req.headers.origin)) return res.status(403).json({ error: 'Cross-origin access denied' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '256kb' }));
const peers = new Set();
const state = { instanceRoot:appRoot, workspace, board: null, projects: [], status: 'connecting', observedAt: null, error: null,
  live: null, agent: { connected: false, busy: false }, activity: [], messages: [], surfaces: {}, requests: [], permissions: [], drc: null };
const approvals = new ApprovalStore(join(runtime, 'permissions.json'));
const activeItems = new Map();
const renders = new RenderStore({root:join(runtime,'renders'),appRoot,onChange:job=>{
  state.renders=renders.list(state.board);publish('renders', state.renders);
  activity(`Render · ${job.stage}`,job.status==='failed'?'error':job.status==='completed'?'completed':'running',job.error||job.options.camera,job.id);
}});
await renders.init();
let aiRenderId=null, aiImageTask=null, studioStarting=false;
function publishPermissions() { state.permissions = approvals.list(state.board); publish('permissions', state.permissions); }
let konnect, agent, connecting, refreshing, startingTurn = false, threadId, turnId, boardHash, agentLoaded = false;
let persistence = Promise.resolve(), persistTimer;
const sessionPath = join(runtime, 'session.json');
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const snapshot = JSON.stringify({ board: state.board, threadId, messages: state.messages, surfaces: state.surfaces });
    persistence = persistence.then(async () => {
      await writeFile(sessionPath + '.tmp', snapshot, { mode: 0o600 });
      await rename(sessionPath + '.tmp', sessionPath);
    }).catch(e => console.error('Could not save companion history:', e.message));
  }, 300);
}
function publish(type, data) {
  const event = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const res of peers) res.write(event);
  if (['messages', 'surface', 'state', 'agent'].includes(type)) persist();
}
function update() { publish('state', state); }
function activity(label, status = 'completed', details = '', id = randomBytes(6).toString('hex')) {
  const item = { id, label, status, details, time: Date.now() };
  const index = state.activity.findIndex(i => i.id === id);
  if (index < 0) state.activity.unshift(item); else state.activity[index] = item;
  state.activity = state.activity.slice(0, 60);
  publish('activity', state.activity);
}
function upsertMessage(id, role, text) {
  const item = state.messages.find(m => m.id === id);
  if (item) item.text = text; else state.messages.push({ id, role, text });
  state.messages = state.messages.slice(-100);
  publish('messages', state.messages);
}
async function findBoards(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.') || ['node_modules', 'apps'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await findBoards(path));
    else if (entry.isFile() && entry.name.endsWith('.kicad_pcb')) found.push({ path, name: entry.name.replace('.kicad_pcb', '') });
  }
  return found;
}
state.projects = await findBoards(config.boardsDir);
state.board = state.projects[0]?.path || null;
try {
  const saved = JSON.parse(await readFile(sessionPath, 'utf8'));
  if (state.projects.some(p => p.path === saved.board)) {
    state.board = saved.board; threadId = saved.threadId;
    state.messages = Array.isArray(saved.messages) ? saved.messages.slice(-100) : [];
    state.surfaces = saved.surfaces || {}; state.agent.threadId = threadId;
  }
} catch { /* First launch starts with an empty local conversation. */ }
state.permissions = approvals.list(state.board);
state.renders = renders.list(state.board);

function observer(request) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(config.observerPython, [join(appRoot, 'server/observer.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('KiCad observer timed out')); }, 10000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.stdout.on('data', b => { stdout += b; if (stdout.length > 12e6) child.kill(); });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-1500); });
    child.on('close', () => {
      clearTimeout(timer);
      try { const data = JSON.parse(stdout); if (data.error) reject(new Error(data.error)); else resolveResult(data); }
      catch (e) { reject(new Error(stderr || e.message)); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      if (!state.board) throw new Error('No board selected. Set COMPANION_WORKSPACE to your project folder, then restart.');
      const live = await observer({ board: state.board });
      const nextHash = createHash('sha256').update(JSON.stringify({ components: live.components.map(({selected, ...c}) => c), tracks: live.tracks, shapes: live.shapes })).digest('hex');
      if (boardHash && boardHash !== nextHash) activity('Board changed in KiCad', 'completed', 'Live component and routing context refreshed.');
      boardHash = nextHash;
      const wasLive = state.status === 'live';
      state.live = live; state.status = 'live'; state.observedAt = new Date().toISOString(); state.error = null;
      if (!wasLive) activity('Connected to KiCad', 'completed', basename(state.board));
    } catch (e) {
      if (state.status === 'live') activity('KiCad connection interrupted', 'error', e.message);
      state.status = 'disconnected'; state.error = e.message;
      // Keep last observation visible, but its timestamp and stale state remain unchanged.
    }
    publish('board', { board: state.board, status: state.status, observedAt: state.observedAt, error: state.error, live: state.live, drc: state.drc });
  })().finally(() => { refreshing = null; });
  return refreshing;
}
function context() {
  return { board: state.board, status: state.status, observedAt: state.observedAt,
    stale: state.status !== 'live' || !state.observedAt || Date.now() - Date.parse(state.observedAt) > 10000,
    error: state.error, live: state.live, drc: state.drc, renders:renders.list(state.board) };
}
async function select(reference) {
  if (state.status !== 'live') throw new Error('Selection requires a live connection');
  await observer({ action: 'select', board: state.board, reference });
  activity(`Selected ${reference}`, 'completed', 'Selection synchronized with KiCad.');
  await refresh();
  return { reference, selected: state.live.selection };
}
function present(input) {
  const messages = visualMessages(input);
  state.surfaces[input.id] = messages;
  const ids = Object.keys(state.surfaces);
  if (ids.length > 20) delete state.surfaces[ids[0]];
  publish('surface', { id: input.id, messages });
  return { accepted: true, surfaceId: input.id, location: 'Companion Visuals tab' };
}
function handleAgentEvent({ method, params: p = {} }) {
  if (method === 'serverRequest/resolved') {
    state.requests = state.requests.filter(r => r.id !== p.requestId);
    publish('requests', state.requests);
  }
  if (method === 'turn/started') { turnId = p.turn.id; state.agent.busy = true; }
  if (method === 'turn/completed') {
    if(aiRenderId) {
      const id=aiRenderId; aiRenderId=null;
      Promise.resolve(aiImageTask).catch(()=>{}).then(async()=>{
        const job=renders.get(id);
        if(job.ai?.status==='running') {job.ai.status='failed';job.ai.error=p.turn.error?.message||'No image was returned. Read the conversation for details, then retry.';await renders.save(job);}
      });
    }
    state.requests = state.requests.filter(r => r.params.turnId !== p.turn.id);
    activeItems.clear(); publish('requests', state.requests);
    turnId = null; state.agent.busy = false;
    activity(p.turn.status === 'completed' ? 'Agent finished' : `Agent ${p.turn.status}`, p.turn.status === 'failed' ? 'error' : 'completed', p.turn.error?.message || '');
    if (p.turn.error) upsertMessage(`error-${p.turn.id}`, 'system', p.turn.error.message);
    refresh();
  }
  if (method === 'item/agentMessage/delta') {
    const prior = state.messages.find(m => m.id === p.itemId)?.text || '';
    upsertMessage(p.itemId, 'assistant', prior + p.delta);
  }
  if (method === 'item/started' || method === 'item/completed') {
    const i = p.item;
    if (method === 'item/started') activeItems.set(i.id, { ...i, threadId: p.threadId, turnId: p.turnId });
    else activeItems.delete(i.id);
    if (i.type === 'agentMessage' && i.text) upsertMessage(i.id, 'assistant', i.text);
    if(i.type==='imageGeneration' && aiRenderId) {
      const id=aiRenderId;
      activity('AI studio image',method.endsWith('started')?'running':'completed','Illustrative image generation; not an engineering reference.',`ai-${id}`);
      if(method==='item/completed') aiImageTask=renders.receiveAI(id,i).catch(async e=>{const job=renders.get(id);job.ai.status='failed';job.ai.error=e.message;await renders.save(job)});
    }
    if (i.type === 'mcpToolCall') {
      activity(`${i.server} · ${i.tool}`, i.error || i.result?.isError ? 'error' : method.endsWith('started') ? 'running' : 'completed', JSON.stringify({ arguments: i.arguments, error: i.error, result: i.result }).slice(0, 14000), i.id);
      if (method.endsWith('completed')) refresh();
    } else if (['commandExecution', 'fileChange', 'webSearch'].includes(i.type)) {
      activity(i.command || i.query || 'File change', method.endsWith('started') ? 'running' : 'completed', i.aggregatedOutput?.slice(-3000) || '', i.id);
    }
  }
  if (method === 'error') upsertMessage(`error-${Date.now()}`, 'system', p.error?.message || JSON.stringify(p));
  publish('agent', state.agent);
}
async function connectAgent() {
  if (state.agent.connected) return;
  if (connecting) return connecting;
  connecting = (async () => {
    agent?.close();
    agentLoaded = false;
    agent = new CodexAgent({ cwd: workspace, url, token, toolPath: join(appRoot, 'server/ui-mcp.mjs'),
      onEvent: handleAgentEvent,
      onStatus: status => {
        state.agent = { ...state.agent, ...status };
        if (!status.connected) {
          state.agent.busy = false; state.requests = []; activeItems.clear(); publish('requests', []);
          if(aiRenderId){const job=renders.get(aiRenderId);aiRenderId=null;job.ai={...job.ai,status:'failed',error:'Codex disconnected during generation. Reconnect and retry.'};renders.save(job).catch(e=>activity('Could not save render status','error',e.message));}
        }
        publish('agent', state.agent);
      },
      onRequest: request => {
        const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request'];
        if (!supported.includes(request.method)) {
          agent.send({ id: request.id, error: { code: -32601, message: 'Request not supported by this companion' } });
          activity('Unsupported agent request', 'error', request.method); return;
        }
        request.approval = approvalScope(request, state.board, activeItems);
        if (approvals.allows(request.approval)) {
          agent.respond(request.id, approvalResponse(request, 'accept'));
          activity(`Auto-allowed · ${request.approval.label}`, 'completed', 'Matched your remembered permission for this board. Revoke it from Permissions.');
          return;
        }
        state.requests.push(request); publish('requests', state.requests);
      },
    });
    await agent.connect();
  })().finally(() => { connecting = null; });
  return connecting;
}
async function chat(text, mode = 'agent', imagePath = null, displayText = text) {
  if(!state.board)throw new Error('Choose a workspace containing a PCB before starting the agent');
  if (startingTurn) throw new Error('A turn is starting; please wait');
  startingTurn = true;
  try {
    await connectAgent();
    if (!state.agent.signedIn) throw new Error('Codex is not signed in. Run codex login, then reconnect.');
    await refresh();
    if (threadId && !agentLoaded) {
      await agent.request('thread/resume', { threadId, cwd: workspace });
      agentLoaded = true;
    }
    if (!threadId) {
      const result = await agent.request('thread/start', { cwd: workspace, approvalPolicy: 'on-request', sandbox: 'workspace-write',
        developerInstructions: `You are the KiCad Companion, working alongside the user in a separate rich window. The selected board is ${state.board}. Use companion.get_context at the start and before any board mutation; require status live and stale false for PCB modifications. Verify requested board is open with Konnect. Every KiCad source edit MUST use Konnect MCP. Never manually edit KiCad files. Use companion.select_component to highlight affected parts. Read the installed Konnect skills. Explain each meaningful operation before performing it and verify afterwards. Get current tool schemas through Konnect discovery; never guess arguments. Work in bounded undoable operations where supported. User interaction and manual changes may happen at any time; reread state. The overview is live simplified geometry, not KiCad's exact viewport. Run checks when appropriate; kicad-cli checks inspect SAVED files and must be labeled accordingly. Use companion.present_visual for useful charts, tables and connection graphs with source and units. No invented measurements or certification claims. Never change a board other than the selected board. Do not modify the companion app itself unless explicitly asked.`,
      });
      threadId = result.thread.id;
      agentLoaded = true;
      state.agent.threadId = threadId;
    }
    const input = [{ type: 'text', text: `${mode === 'discuss' ? 'DISCUSS ONLY: explain and inspect, do not modify design files. ' : ''}${text}\n\nCompanion context: ${JSON.stringify({ board: state.board, status: state.status, observedAt: state.observedAt, selectedReferences: state.live?.selection || [] })}` }];
    if(imagePath)input.push({type:'localImage',path:imagePath});
    upsertMessage(randomBytes(8).toString('hex'), 'user', displayText);
    if (state.agent.busy && turnId) await agent.request('turn/steer', { threadId, expectedTurnId: turnId, input });
    else {
      state.agent.busy = true; publish('agent', state.agent);
      const result = await agent.request('turn/start', { threadId, input });
      turnId = result.turn.id;
    }
    return { threadId, turnId };
  } catch (e) { if (!turnId) state.agent.busy = false; publish('agent', state.agent); throw e; }
  finally { startingTurn = false; }
}

app.get('/api/state', (req, res) => res.json({...state,renders:renders.list(state.board)}));
app.get('/api/renders', (req,res)=>res.json(renders.list(state.board)));
app.post('/api/renders', async(req,res)=>res.json(await renders.start(state.board,req.body)));
app.get('/api/renders/:id/:kind.png', (req,res)=>{
  const job=renders.get(req.params.id),kind=req.params.kind;
  if(kind==='actual'?job.status!=='completed':kind!=='ai'||job.ai?.status!=='completed')return res.status(404).json({error:'Image is not ready'});
  res.set('Cache-Control',kind==='actual'?'private, max-age=31536000, immutable':'private, no-cache');res.sendFile(renders.path(job.id,kind),{dotfiles:'allow'});
});
app.post('/api/renders/:id/studio', async(req,res)=>{
  if(state.agent.busy||startingTurn||aiRenderId||studioStarting)throw new Error('Wait for the current agent turn to finish');
  studioStarting=true;
  try {
  await connectAgent();
  if(!state.agent.imageGeneration)throw new Error('Image generation is not available through this Codex runtime');
  const job=renders.get(req.params.id);
  if(job.board!==state.board||job.status!=='completed')throw new Error('Render the selected board first');
  if((await fingerprint(job.board)).sha256!==job.source.sha256)throw new Error('The saved board has changed. Create a fresh actual render first.');
  const style=z.string().trim().max(1200).parse(req.body.style||'Soft studio lighting on a neutral background');
  const prompt=`Create one AI studio image using the built-in image generation tool, editing the attached actual KiCad render as the reference. Preserve board outline, holes, connector positions, components that are visible, and the ${job.options.color==='kicad'?'original':job.options.color} solder mask. Never add imagined components or connections. This is an illustrative product image, not engineering evidence. Visual direction: ${style}. Model coverage report: ${JSON.stringify(job.models)}. If components have no models, leave them absent; do not invent populated geometry. Use the built-in image generation tool only, not a shell, script, or API-key fallback. Do not edit or save any KiCad file or change component selection. Return the generated image.`;
  job.ai={status:'running',startedAt:new Date().toISOString(),prompt,provider:'Codex built-in image generation',sourceRenderId:job.id};
  aiRenderId=job.id;aiImageTask=null;await renders.save(job);
  try {res.json(await chat(prompt,'agent',renders.path(job.id),`Create an AI studio image from the ${job.options.color} ${job.options.camera} render. ${style}`));}
  catch(e){aiRenderId=null;job.ai.status='failed';job.ai.error=e.message;await renders.save(job);throw e;}
  }finally{studioStarting=false;}
});
app.get('/api/appearance', async (req, res) => res.json(await readKiCadAppearance()));
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders(); peers.add(res); res.write(`data: ${JSON.stringify({ type: 'state', data: state })}\n\n`);
  res.write(`data: ${JSON.stringify({type:'renders',data:renders.list(state.board)})}\n\n`);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => { clearInterval(heartbeat); peers.delete(res); });
});
app.post('/api/refresh', async (req, res) => { await refresh(); res.json(context()); });
app.post('/api/select', async (req, res) => res.json(await select(z.string().min(1).max(40).parse(req.body.reference))));
app.post('/api/project', async (req, res) => {
  if (state.agent.busy || startingTurn || studioStarting || aiRenderId) return res.status(409).json({ error: 'Stop the agent before changing boards' });
  if (!state.projects.some(p => p.path === req.body.path)) return res.status(400).json({ error: 'Unknown board' });
  state.board = req.body.path; state.live = null; state.observedAt = null; state.drc = null; boardHash = null;
  state.renders=renders.list(state.board);
  state.messages = []; state.surfaces = {}; state.agent.threadId = null; threadId = null; agentLoaded = false;
  state.requests = []; activeItems.clear(); publishPermissions();
  await refresh(); update(); res.json({ ok: true });
});
app.post('/api/open', async (req, res) => {
  if (process.platform !== 'darwin') throw new Error('Automatic editor launch is currently implemented for macOS');
  if(!state.board)throw new Error('No board selected');
  await promisify(execFile)('open', ['-a', config.pcbEditor, state.board]);
  res.json({ opened: true });
});
app.post('/api/chat', async (req, res) => {
  if(aiRenderId||studioStarting)throw new Error('AI studio is generating. Wait, or use Stop before starting a different request.');
  res.json(await chat(z.string().min(1).max(16000).parse(req.body.text), z.enum(['agent', 'discuss']).parse(req.body.mode || 'agent')));
});
app.post('/api/stop', async (req, res) => {
  if (threadId && turnId) await agent.request('turn/interrupt', { threadId, turnId });
  res.json({ interrupted: Boolean(turnId) });
});
app.post('/api/connect', async (req, res) => { await connectAgent(); res.json(state.agent); });
app.post('/api/respond', async (req, res) => {
  const pending = state.requests.find(r => r.id === req.body.id);
  if (!pending) return res.status(404).json({ error: 'Request no longer pending' });
  let result;
  if (pending.method === 'item/tool/requestUserInput') result = { answers: z.record(z.object({ answers: z.array(z.string()) })).parse(req.body.answers) };
  else {
    result = approvalResponse(pending, req.body.decision, req.body.content ?? null);
    if (req.body.decision === 'always') {
      if (!pending.approval || pending.approval.board !== state.board) throw new Error('This request cannot be remembered for the current board');
      approvals.remember(pending.approval); publishPermissions();
    }
  }
  agent.respond(pending.id, result); state.requests = state.requests.filter(r => r.id !== pending.id); publish('requests', state.requests);
  if (req.body.decision === 'always') {
    // One click also clears already queued copies of the exact same permission.
    for (const duplicate of [...state.requests]) {
      if (!approvals.allows(duplicate.approval)) continue;
      agent.respond(duplicate.id, approvalResponse(duplicate, 'accept'));
      state.requests = state.requests.filter(r => r.id !== duplicate.id);
      activity(`Auto-allowed · ${duplicate.approval.label}`, 'completed', 'Matched your remembered permission for this board.');
    }
    publish('requests', state.requests);
  }
  res.json({ ok: true });
});
app.post('/api/permissions/revoke', (req, res) => {
  approvals.revoke(z.string().regex(/^[a-f0-9]{64}$/).parse(req.body.key), state.board);
  publishPermissions(); activity('Remembered permission removed', 'completed', 'The matching action will ask again next time.');
  res.json({ ok: true });
});
app.post('/api/drc', async (req, res) => {
  if (!konnect) throw new Error('Konnect observer is not ready');
  const board = state.board;
  activity('Checking saved board', 'running', 'KiCad CLI DRC does not include unsaved edits.', 'drc');
  try {
    const before = (await stat(board)).mtimeMs;
    const report = await konnect.call('run_drc', { board, limit: 100 });
    const after = (await stat(board)).mtimeMs;
    if (board !== state.board || before !== after) throw new Error('Board changed during DRC; rerun the check');
    state.drc = { report, source: 'saved-file', board, fileModifiedAt: new Date(after).toISOString(), checkedAt: new Date().toISOString() };
    activity('Saved-board check complete', 'completed', JSON.stringify(report.summary || report).slice(0, 1200), 'drc');
    update(); res.json(state.drc);
  } catch (e) { activity('Board check failed', 'error', e.message, 'drc'); throw e; }
});
app.post('/api/visualize-board', async (req, res) => {
  await refresh();
  if (state.status !== 'live') throw new Error('Live board data is unavailable');
  const counts = {};
  for (const c of state.live.components) { const kind = c.reference.replace(/[0-9]+$/, ''); counts[kind] = (counts[kind] || 0) + 1; }
  res.json(present({ id: 'board-inventory', kind: 'Chart', spec: { title: 'What’s on this board', source: `KiCad IPC · ${state.observedAt}`, type: 'bar', unit: 'components', data: Object.entries(counts).map(([label, value]) => ({label, value})) } }));
});
app.use('/internal', (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${token}`) return res.status(403).json({ error: 'Unauthorized' });
  next();
});
app.post('/internal/context', async (req, res) => { await refresh(); res.json(context()); });
app.post('/internal/select', async (req, res) => res.json(await select(z.string().min(1).max(40).parse(req.body.reference))));
app.post('/internal/visual', (req, res) => res.json(present(req.body)));
app.post('/internal/render', async(req,res)=>res.json(await renders.start(state.board,req.body)));
app.post('/internal/render-status', (req,res)=>{
  const job=renders.get(z.string().uuid().parse(req.body.id));
  if(job.board!==state.board)throw new Error('Render belongs to a different board');
  res.json({...job,imagePath:job.status==='completed'?renders.path(job.id):null});
});

if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: appRoot, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(join(appRoot, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(join(appRoot, 'dist/index.html')));
}
app.use((error, req, res, next) => { if (!res.headersSent) res.set('Cache-Control','no-store').status(400).json({ error: error.message }); });
const server = app.listen(port, '127.0.0.1', () => console.log(`KiCad Companion: ${url}`));
server.on('error', e => { console.error(e.message); process.exit(1); });
const interval = setInterval(()=>{if(state.board&&config.autoConnect)refresh()}, 2500);
if(config.autoConnect)await refresh();
else {state.status='disconnected';state.error='Automatic connections disabled for local review';}
if(state.board && config.autoConnect) {
try { konnect = new Konnect(); await konnect.connect(); activity('Konnect MCP ready'); }
catch (e) { activity('Konnect observer failed', 'error', e.message); }
connectAgent().catch(e => { state.agent.error = e.message; publish('agent', state.agent); });
}
async function stop() { clearInterval(interval); renders.close(); agent?.close(); await konnect?.close(); server.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
