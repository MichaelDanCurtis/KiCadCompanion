import test from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import {HostClient, admittedNames, inspectEnabledTools, admitExecutionRequest, startCodeModeGateway} from '../server/code-mode-gateway.mjs';

const valid = () => ({sessionId: 'test', executionId: 'test', source: "text('test')", enabledTools: admittedNames.map(name => ({
  name, toolName: {name}, kind: 1, inputSchemaJson: Buffer.from('{"type":"object"}'),
}))});
const extras = () => [['clock', 'curr_time'], ['skills', 'list'], ['skills', 'read']].map(([namespace, name]) => ({
  name: `${namespace}__${name}`, kind: 1, toolName: {namespace, name},
}));

test('observed clock/skills extras are removed, never authorized; unknown or aliased extras fail closed', () => {
  const request = valid(); request.enabledTools.push(...extras());
  const result = admitExecutionRequest(request);
  assert.deepEqual(result.forwarded, valid());
  assert.equal(request.enabledTools.length, 6); // The source request is not rewritten.
  assert.deepEqual(result.removedTools, ['clock__curr_time', 'skills__list', 'skills__read']);
  request.enabledTools[3].toolName.name = 'shell';
  assert.throws(() => admitExecutionRequest(request));
  const unknown = valid(); unknown.enabledTools.push({...extras()[0], name: 'unknown'});
  assert.throws(() => admitExecutionRequest(unknown));
});

test('Code Mode admission rejects missing, extra, duplicate, aliased and namespaced tools', () => {
  assert.deepEqual(inspectEnabledTools(valid()).map(t => t.name), admittedNames);
  const stripped = valid();
  for (const tool of stripped.enabledTools) delete tool.inputSchemaJson;
  assert.deepEqual(inspectEnabledTools(stripped), admittedNames.map(name => ({name, schemaSha256: null})));
  for (const modify of [
    r => r.enabledTools.pop(),
    r => r.enabledTools.push({...r.enabledTools[0], name: 'exec_command'}),
    r => {r.enabledTools[1] = r.enabledTools[0];},
    r => {r.enabledTools[0].toolName.name = 'shell';},
    r => {r.enabledTools[0].toolName.namespace = 'evil';},
    r => {r.enabledTools[0].kind = 2;},
    r => {r.enabledTools[0].inputSchemaJson = Buffer.from('not-json');},
  ]) {
    const request = valid(); modify(request);
    assert.throws(() => inspectEnabledTools(request));
  }
});

test('Code Mode gateway rejects before upstream execution; forwards permitted stream and closes', async t => {
  const upstream = new grpc.Server(); let executions = 0;
  upstream.addService(HostClient.service, {
    execute(call) {
      assert.deepEqual(call.request.enabledTools.map(tool => tool.name).sort(), admittedNames);
      executions++; call.write({outcome: {cellId: 'test', completed: {}}}); call.end();
    },
  });
  const port = await new Promise((resolve, reject) => upstream.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
    (error, value) => error ? reject(error) : resolve(value)));
  t.after(() => upstream.forceShutdown());
  const gateway = await startCodeModeGateway({upstreamUrl: `http://127.0.0.1:${port}`});
  t.after(() => gateway.close());
  const client = new HostClient(new URL(gateway.url).host, grpc.credentials.createInsecure());
  t.after(() => client.close());
  const execute = request => new Promise((resolve, reject) => {
    const values = [];
    const call = client.execute(request, {deadline: Date.now() + 3000});
    call.on('data', v => values.push(v)); call.on('error', reject); call.on('end', () => resolve(values));
  });
  const bad = valid(); bad.enabledTools[0].toolName.name = 'shell';
  await assert.rejects(execute(bad), e => e.code === grpc.status.PERMISSION_DENIED);
  assert.equal(executions, 0);
  const request = valid(); request.enabledTools.push(...extras());
  const values = await execute(request);
  assert.equal(values[0].outcome.cellId, 'test'); assert.equal(executions, 1);
  assert.equal(gateway.evidence.rejectedExecutions, 1);
  assert.equal(gateway.evidence.forwardedExecutions, 1);
  assert.equal(gateway.evidence.admittedExecutions.length, 1);
  assert.ok(!JSON.stringify(gateway.evidence).includes("text('test')"));
  await gateway.close();
  await assert.rejects(execute(valid())); assert.equal(executions, 1);
});

test('Code Mode gateway refuses non-loopback and credential-bearing upstreams', async () => {
  for (const upstreamUrl of ['http://example.com:1234', 'http://user:password@127.0.0.1:1234',
    'https://127.0.0.1:1234', 'http://127.0.0.1:1234/path', 'http://127.0.0.1:1234/?x=1']) {
    await assert.rejects(startCodeModeGateway({upstreamUrl}));
  }
});

test('Code Mode gateway forwards empty subscription readiness and cancellation', async t => {
  const upstream = new grpc.Server();
  let cancelled;
  const cancelledPromise = new Promise(resolve => {cancelled = resolve;});
  upstream.addService(HostClient.service, {
    subscribeToToolCalls(call) {
      call.on('cancelled', cancelled);
      call.sendMetadata(new grpc.Metadata()); // No tool call until Execute.
    },
  });
  const port = await new Promise((resolve, reject) => upstream.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
    (error, value) => error ? reject(error) : resolve(value)));
  t.after(() => upstream.forceShutdown());
  const gateway = await startCodeModeGateway({upstreamUrl: `http://127.0.0.1:${port}`});
  t.after(() => gateway.close());
  const client = new HostClient(new URL(gateway.url).host, grpc.credentials.createInsecure());
  t.after(() => client.close());
  const call = client.subscribeToToolCalls({sessionId: 'test'}, {deadline: Date.now() + 3000});
  await new Promise((resolve, reject) => {call.once('metadata', resolve); call.once('error', reject);});
  const status = new Promise(resolve => call.once('error', resolve));
  call.cancel(); assert.equal((await status).code, grpc.status.CANCELLED);
  await Promise.race([cancelledPromise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Error('Cancellation was not forwarded')), 3000);
    cancelledPromise.then(() => clearTimeout(timer));
  })]);
});
