import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAgent } from '../server/codex.mjs';
import { unpack } from '../server/konnect.mjs';
test('Konnect errors never become successful observations', () => {
  assert.throws(()=>unpack({isError:true,content:[{type:'text',text:'{"message":"Wrong board"}'}]}),/Wrong board/);
  assert.deepEqual(unpack({content:[{type:'text',text:'{"source":"ipc"}'}]}),{source:'ipc'});
});
test('Codex RPC resolves matching responses and separates server requests from notifications', async () => {
  const events=[], requests=[], sent=[];
  const agent=new CodexAgent({onEvent:e=>events.push(e),onRequest:r=>requests.push(r),onStatus:()=>{}});
  agent.send=m=>sent.push(m);
  const response=agent.request('account/read',{},2000);
  agent.receive({id:sent[0].id,result:{account:{type:'chatgpt'}}});
  assert.equal((await response).account.type,'chatgpt');
  agent.receive({method:'turn/completed',params:{turn:{id:'a'}}});
  agent.receive({method:'item/commandExecution/requestApproval',id:80,params:{}});
  assert.equal(events.length,1); assert.equal(requests.length,1);
  const failure=agent.request('thread/start',{},2000);
  agent.receive({id:sent.at(-1).id,error:{message:'Model unavailable'}});
  await assert.rejects(failure,/Model unavailable/);
  assert.equal(agent.pending.size,0);
});
