// Manual, explicit one-turn qualification only. Never mounted in production.
import express from 'express';
import {createServer} from 'vite';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer as createHttpServer} from 'node:http';
import {authenticatedUiOptions, authenticatedProductApproval} from './authenticated-product-approval.mjs';
import {productProviderRoutes} from '../../server/provider-controller.mjs';
import {actionRoutes} from '../../server/action-routes.mjs';

const options = authenticatedUiOptions(process.argv.slice(2));
const f = await authenticatedProductApproval(options);
const app = express(); let origin, closing, expiry;
app.use((req, res, next) => {
  if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store'); next();
});
app.use(express.json({limit: '32kb'}));
const project = {manifest: {id: f.scope.projectId, name: 'Authenticated approval qualification — TEST ONLY', revision: 1,
  artifacts: [{id: f.target.documentId, name: 'In-memory fixture label', kind: 'fixture', path: 'fixture.txt'}]},
  hash: f.scope.expectedManifestHash, local: {epoch: f.scope.expectedEpoch}, fixturePrompt: f.prompt,
  fixtureNote: 'TEST ONLY. Real signed-in model candidate, actual product controller and approval UI. One connection and one model turn; select Agent and this fixture document, then send the exact prefilled prompt. Choose Allow once or Decline below. No automatic approval, CAD adapters or customer files. Production remains disabled. Model usage applies only after Send.'};
app.get('/fixture/project', (req, res) => res.json(project));
app.get('/fixture/evidence', (req, res) => res.json(f.evidence()));
app.get('/api/provider/product/capabilities', (req, res) => res.json({modes: {
  discuss: {supported: false, reason: 'This bounded qualification tests Agent approval only.'}, agent: {supported: true},
}}));
// This journey must use the model's mediated proposal/execute callbacks. Keep
// human decisions/cancellation/revocation, but forbid manual substitute actions.
app.use('/api/actions', (req, res, next) => {
  if (req.method === 'POST' && (req.path === '/prepare' || req.path.endsWith('/execute'))) return res.sendStatus(403);
  next();
});
productProviderRoutes(app, f.controller); actionRoutes(app, f.gate, f.gate.adapters);
const server = createHttpServer(app);
const vite = await createServer({root: fileURLToPath(new URL('../../', import.meta.url)),
  server: {middlewareMode: true, hmr: {server},
    fs: {deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.runtime/**']}}, appType: 'custom'});
app.get('/', async (req, res) => res.type('html').send(await vite.transformIndexHtml('/',
  '<!doctype html><html><head><link rel="icon" href="data:,"><title>Benchline authenticated approval — TEST ONLY</title></head><body style="margin:0;background:#131b26"><div id="root"></div><script type="module" src="/tests/fixtures/product-approval-ui.jsx"></script></body></html>')));
app.use(vite.middlewares);
app.use((error, req, res, next) => res.status(error.status || 400).json({error: 'Qualification request rejected; do not retry an uncertain turn.'}));
server.listen(0, '127.0.0.1'); await once(server, 'listening');
origin = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({origin, evidence: join(f.root, 'ui-evidence.json'), authenticatedCandidate: true, productionEnabled: false}));
async function close() {
  if (closing) return closing;
  closing = (async () => {
    clearTimeout(expiry);
    try {await f.close();}
    finally {
      await writeFile(join(f.root, 'ui-evidence.json'), JSON.stringify(f.evidence(), null, 2), {mode: 0o600});
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await vite.close();
    }
  })();
  return closing;
}
// An abandoned page must not retain a signed-in child indefinitely.
expiry = setTimeout(() => close().catch(() => {process.exitCode = 1;}), 10 * 60 * 1000);
process.once('SIGINT', () => close().catch(() => {process.exitCode = 1;}));
process.once('SIGTERM', () => close().catch(() => {process.exitCode = 1;}));
