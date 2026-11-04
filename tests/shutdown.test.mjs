import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {createShutdown, closeHttpServer} from '../server/shutdown.mjs';

test('shutdown attempts every owner after synchronous and asynchronous cleanup failures', async () => {
  const calls = [], sync = Error('sync private detail'), asyncError = Error('async private detail');
  const stop = createShutdown({steps: [
    {name: 'product', close: () => {calls.push('product'); throw sync;}},
    {name: 'account', close: async () => {calls.push('account'); throw asyncError;}},
    {name: 'native', close: async () => {calls.push('native');}},
    {name: 'HTTP', close: () => {calls.push('HTTP');}},
  ]});
  const result = await stop();
  assert.deepEqual(calls, ['product', 'account', 'native', 'HTTP']);
  assert.deepEqual(result, {ok: false, failures: [{name: 'product', error: sync}, {name: 'account', error: asyncError}]});
});

test('repeated signals share one promise and wait for slow ownership cleanup before finalizing', async () => {
  let release, entered, finalizations = 0, slowCalls = 0;
  const started = new Promise(resolve => {entered = resolve;}), stopped = new Promise(resolve => {release = resolve;});
  const stop = createShutdown({steps: [
    {name: 'journal', close: async () => {throw Error('Journal unavailable');}},
    {name: 'dispatcher', close: async () => {slowCalls++; entered(); await stopped;}},
  ], finish: result => {finalizations++; return result;}});
  const first = stop(); assert.equal(stop(), first);
  await started; assert.equal(finalizations, 0); assert.equal(slowCalls, 1);
  release(); const result = await first;
  assert.equal(result.ok, false); assert.equal(finalizations, 1);
  assert.equal(stop(), first); await stop(); assert.equal(finalizations, 1);
});

test('successful shutdown finalizes once with no failures', async () => {
  let finishes = 0;
  const stop = createShutdown({steps: [{name: 'owner', close: async () => {}}],
    finish: result => {finishes++; return result;}});
  assert.deepEqual(await stop(), {ok: true, failures: []});
  assert.equal(finishes, 1);
});

test('HTTP shutdown stops listening and closes an established connection despite another owner failure', {timeout: 5000}, async t => {
  const server = createServer((req, res) => {res.writeHead(200); res.write('open stream');});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const socket = createConnection({host: '127.0.0.1', port: server.address().port});
  t.after(() => {socket.destroy(); server.closeAllConnections(); server.close();});
  socket.on('error', () => {});
  await once(socket, 'connect');
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n'); await once(socket, 'data');
  const disconnected = once(socket, 'close');
  const stop = createShutdown({steps: [
    {name: 'product', close: async () => {throw Error('Journal cleanup rejected');}},
    {name: 'HTTP', close: () => closeHttpServer(server)},
  ]});
  const result = await stop(); await disconnected;
  assert.equal(server.listening, false); assert.equal(socket.destroyed, true);
  assert.deepEqual(result.failures.map(item => item.name), ['product']);
});

test('HTTP close failure still attempts established-connection cleanup', async () => {
  const failure = Error('Server close failed'); let dropped = 0;
  await assert.rejects(closeHttpServer({close() {throw failure;}, closeAllConnections() {dropped++;}}), error => error === failure);
  assert.equal(dropped, 1);
});
