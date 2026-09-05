import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore, approvalResponse, approvalScope } from '../server/approvals.mjs';

const board = '/test/board.kicad_pcb';
const request = (overrides={}) => ({ id: 1, method: 'mcpServer/elicitation/request', params: {
  mode: 'form', serverName: 'companion', message: 'Allow get_context?', requestedSchema: { type: 'object', properties: {} },
  threadId: 'thread', turnId: 'turn', _meta: null, ...overrides,
} });
test('allow once and decline have correct wire semantics and do not create remembered permissions', () => {
  assert.deepEqual(approvalResponse(request(),'accept'),{action:'accept',content:null});
  assert.deepEqual(approvalResponse(request(),'decline',{secret:'never forwarded'}),{action:'decline',content:null});
  assert.deepEqual(approvalResponse({method:'item/commandExecution/requestApproval'},'always'),{decision:'accept'});
  assert.throws(()=>approvalResponse(request(),'acceptForSession'),/Invalid/);
});
test('remembered consent survives restart, is board/server/tool/prompt scoped, and can be revoked', () => {
  const dir=mkdtempSync(join(tmpdir(),'companion-approvals-'));
  try {
    const path=join(dir,'permissions.json'), store=new ApprovalStore(path);
    const items=new Map([['i',{type:'mcpToolCall',server:'companion',tool:'get_context',threadId:'thread',turnId:'turn'}]]);
    const scope=approvalScope(request(),board,items);
    assert.equal(store.allows(scope),false);
    store.remember(scope);
    assert.equal(statSync(path).mode & 0o777,0o600);
    assert.equal(readFileSync(path,'utf8').includes('Allow get_context?'),false);
    const resumed=new ApprovalStore(path);
    assert.equal(resumed.allows(scope),true);
    assert.equal(resumed.allows(approvalScope(request(),'/other/board',items)),false);
    assert.equal(resumed.allows(approvalScope(request({serverName:'konnect'}),board,items)),false);
    assert.equal(resumed.allows(approvalScope(request({message:'Allow delete_board?'}),board,items)),false);
    assert.equal(resumed.allows(approvalScope(request({_meta:{permissions:['write']}}),board,items)),false);
    items.get('i').tool='delete_board';
    assert.equal(resumed.allows(approvalScope(request(),board,items)),false);
    resumed.revoke(scope.key,board);
    assert.equal(new ApprovalStore(path).allows(scope),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('auth URLs, structured forms, questions and ambiguous requests are never remembered', () => {
  assert.equal(approvalScope(request(),board),null);
  assert.equal(approvalScope(request({mode:'url',url:'https://example.com/login'}),board),null);
  assert.equal(approvalScope(request({requestedSchema:{type:'object',properties:{password:{type:'string'}}}}),board),null);
  assert.equal(approvalScope(request({requestedSchema:null}),board),null);
  assert.equal(approvalScope({method:'item/tool/requestUserInput',params:{}},board),null);
  assert.equal(approvalScope(request(),null),null);
});
test('command scopes require exact command, cwd and permission details; patches require exact contents', () => {
  const r={method:'item/commandExecution/requestApproval',params:{command:'pwd',cwd:'/test',threadId:'a',turnId:'b',itemId:'c',startedAtMs:1}};
  const scope=approvalScope(r,board);
  assert.equal(scope.key,approvalScope({...r,params:{...r.params,turnId:'next',startedAtMs:2}},board).key);
  for(const change of [{command:'pwd; whoami'},{cwd:'/other'},{additionalPermissions:{network:true}}]) {
    assert.notEqual(scope.key,approvalScope({...r,params:{...r.params,...change}},board).key);
  }
  assert.equal(approvalScope({...r,params:{...r.params,networkApprovalContext:{host:'example.com'}}},board),null);
  const f={method:'item/fileChange/requestApproval',params:{itemId:'i'}};
  assert.equal(approvalScope(f,board),null);
  const items=new Map([['i',{changes:[{path:'/test/a',diff:'a -> b'}]}]]);
  const first=approvalScope(f,board,items);
  items.get('i').changes[0].diff='a -> c';
  assert.notEqual(first.key,approvalScope(f,board,items).key);
});
