// Version-pinned admission boundary for an owned local Code Mode host.
// This is one layer of provider qualification, not an app-server sandbox.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import grpc from '@grpc/grpc-js';
import {loadSync} from '@grpc/proto-loader';

const protocolPath = fileURLToPath(new URL('./vendor/code-mode-protocol/codex.code_mode.v1.proto', import.meta.url));
assert.equal(createHash('sha256').update(readFileSync(protocolPath)).digest('hex'),
  '406d8f47d8d0b95a9d4ae104890e5e52764c9597e9271f75ff434a4ce24748d0');
const definition = loadSync(protocolPath,
  {longs: String, enums: Number, defaults: false, oneofs: true});
export const HostClient = grpc.loadPackageDefinition(definition).codex.code_mode.v1.CodeModeHost;
export const admittedNames = Object.freeze(['benchline_action_status', 'benchline_execute_action', 'benchline_prepare_action']);
const options = {'grpc.max_receive_message_length': 1024 * 1024, 'grpc.max_send_message_length': 1024 * 1024};
const denied = () => Object.assign(Error('Benchline code host admission denied'), {code: grpc.status.PERMISSION_DENIED});
const hash = value => createHash('sha256').update(value).digest('hex');

export function inspectEnabledTools(request) {
  const tools = request.enabledTools;
  assert.ok(Array.isArray(tools) && tools.length === admittedNames.length);
  assert.deepEqual(tools.map(tool => tool.name).sort(), admittedNames);
  for (const tool of tools) {
    assert.equal(tool.kind, 1);
    assert.deepEqual(tool.toolName, {name: tool.name});
    // Pinned execute_handler.rs deliberately strips schemas from uncached
    // definitions. Callback validation stays in provider-tools.mjs.
    if (tool.inputSchemaJson !== undefined) {
      assert.ok(Buffer.isBuffer(tool.inputSchemaJson) && tool.inputSchemaJson.length <= 32768);
      assert.equal(JSON.parse(tool.inputSchemaJson.toString()).type, 'object');
    }
    assert.equal(tool.outputSchemaJson, undefined);
  }
  // Evidence excludes descriptions, source, arguments, output and identifiers.
  return tools.map(tool => ({name: tool.name, schemaSha256: tool.inputSchemaJson ? hash(tool.inputSchemaJson) : null}))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function admitExecutionRequest(request) {
  // Observed signed-in-only entries. Remove them; never grant them authority.
  // Unknown additions remain a hard rejection, not silent adaptation to drift.
  const removed = new Map([['clock__curr_time', ['clock', 'curr_time']],
    ['skills__list', ['skills', 'list']], ['skills__read', ['skills', 'read']]]);
  assert.ok(Array.isArray(request.enabledTools) && request.enabledTools.length <= 6);
  const removedTools = [], enabledTools = [];
  for (const tool of request.enabledTools) {
    const mapping = removed.get(tool.name);
    if (!mapping) {enabledTools.push(tool); continue;}
    assert.ok(!removedTools.includes(tool.name));
    assert.equal(tool.kind, 1);
    assert.equal(tool.toolName?.namespace, mapping[0]);
    assert.equal(tool.toolName?.name, mapping[1]);
    removedTools.push(tool.name);
  }
  const forwarded = {...request, enabledTools};
  return {forwarded, tools: inspectEnabledTools(forwarded), removedTools: removedTools.sort()};
}

export async function startCodeModeGateway({upstreamUrl}) {
  const url = new URL(upstreamUrl);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert.ok(url.port); assert.equal(url.pathname, '/');
  assert.equal(url.username + url.password + url.search + url.hash, '');
  const client = new HostClient(url.host, grpc.credentials.createInsecure(), options);
  const server = new grpc.Server(options), active = new Set();
  const evidence = {requests: {}, admittedExecutions: [], rejectedExecutions: 0, rejectedInventories: [], forwardedExecutions: 0};
  let closed = false;
  const handlers = {};
  for (const [method, spec] of Object.entries(HostClient.service)) {
    handlers[method] = (call, callback) => {
      evidence.requests[method] = (evidence.requests[method] || 0) + 1;
      const streaming = spec.responseStream;
      const fail = error => streaming ? call.emit('error', error) : callback(error);
      if (closed || active.size >= 32) return fail(denied());
      let request = call.request;
      if (spec.path.endsWith('/Execute')) {
        try {
          assert.ok(evidence.admittedExecutions.length < 100);
          const admitted = admitExecutionRequest(request);
          request = admitted.forwarded;
          evidence.admittedExecutions.push({tools: admitted.tools, removedTools: admitted.removedTools});
        } catch {
          evidence.rejectedExecutions++;
          // Record only bounded identifier/type metadata, never code, tool
          // descriptions, schemas, arguments, account metadata or results.
          if (evidence.rejectedInventories.length < 10) {
            const name = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,160}$/.test(value) ? value : null;
            evidence.rejectedInventories.push((call.request.enabledTools || []).slice(0, 100).map(tool => ({
              name: name(tool.name), target: name(tool.toolName?.name), namespace: name(tool.toolName?.namespace),
              kind: tool.kind, inputSchemaPresent: tool.inputSchemaJson !== undefined, outputSchemaPresent: tool.outputSchemaJson !== undefined,
            })));
          }
          return fail(denied());
        }
        evidence.forwardedExecutions++;
      }
      // Do not forward incoming metadata (in particular authorization headers).
      const pending = streaming ? client[method](request) : client[method](request, (error, result) => {
        active.delete(pending);
        if (error) callback(Object.assign(Error('Code Mode host unavailable'), {code: error.code}));
        else callback(null, result);
      });
      active.add(pending);
      call.on('cancelled', () => {pending.cancel(); active.delete(pending);});
      if (streaming) {
        // A tool subscription is ready before its first callback. Forward that
        // readiness explicitly or the client waits for headers before Execute,
        // while the host waits for Execute before producing a callback.
        pending.on('metadata', () => call.sendMetadata(new grpc.Metadata()));
        pending.on('data', value => {if (!call.write(value)) pending.pause();});
        call.on('drain', () => pending.resume());
        pending.on('error', error => {
          active.delete(pending);
          call.emit('error', Object.assign(Error('Code Mode host unavailable'), {code: error.code}));
        });
        pending.on('end', () => {active.delete(pending); call.end();});
      }
    };
  }
  server.addService(HostClient.service, handlers);
  const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
    (error, value) => error ? reject(error) : resolve(value)));
  return {
    url: `http://127.0.0.1:${port}`, evidence,
    async close() {
      closed = true;
      for (const pending of active) pending.cancel();
      active.clear(); client.close(); server.forceShutdown();
    },
  };
}
