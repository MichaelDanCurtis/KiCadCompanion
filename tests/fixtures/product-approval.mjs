// Disposable, credential-free fixture. Never registered by the production server.
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ActionGate} from '../../server/actions.mjs';
import {FixtureAdapter} from '../../server/adapters/fixture.mjs';
import {ProductProviderController} from '../../server/provider-controller.mjs';

export async function productApprovalFixture({onTurn,manifestHash='fixture-manifest'} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'benchline-product-approval-'));
  const scope = {projectId: randomUUID(), documentIds: [randomUUID()], mode: 'agent',
    expectedManifestHash: manifestHash, expectedEpoch: randomUUID()};
  const target = {projectId: scope.projectId, documentId: scope.documentIds[0],
    path: join(root, 'fixture.txt'), epoch: scope.expectedEpoch, manifestHash: scope.expectedManifestHash};
  const adapter = new FixtureAdapter();
  let clockOffset = 0, sequence = 0;
  const gate = new ActionGate({path: join(root, 'actions.json'), now: () => Date.now() + clockOffset,
    adapters: new Map([['fixture', adapter]]), resolveTarget: async () => structuredClone(target)});
  await gate.init();
  const rpcs = [], requests = [];
  const controller = new ProductProviderController({gate, requireMode: () => {}, openTransport: async () => {
    const rpc = {closed: false, toolSession: null, async request(method, params) {
      requests.push({method, params});
      if (method === 'thread/start') return {thread: {id: `thread-${++sequence}`}};
      if (method === 'turn/start') {
        const turn = {id: `turn-${++sequence}`};
        if(onTurn)setImmediate(()=>onTurn(rpc,{threadId:params.threadId,turnId:turn.id},params.input[0].text));
        return {turn};
      }
      return {};
    }, async close() {this.closed = true;}};
    rpcs.push(rpc); return rpc;
  }});
  function call(tool, args) {
    const status = rpcs.at(-1).toolSession.snapshot();
    return rpcs.at(-1).toolSession.handle({id: ++sequence, method: 'item/tool/call', params: {
      threadId: status.threadId, turnId: status.turnId, callId: `call-${sequence}`, tool, arguments: args,
    }});
  }
  return {root, scope, target, adapter, gate, controller, rpcs, requests, call,
    advance: ms => {clockOffset += ms;},
    propose: (value = 'Reviewed fixture') => call('benchline_prepare_action', {
      documentId: target.documentId, adapter: 'fixture', operation: 'set-label', args: {value},
    }),
  };
}
