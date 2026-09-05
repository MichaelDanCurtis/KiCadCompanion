import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('clean checkout starts offline without a PCB, account, or existing application state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'companion-startup-'));
  const workspace=join(root,'project');await mkdir(workspace);
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:resolve('.'),env:{...process.env,COMPANION_PORT:String(port),COMPANION_WORKSPACE:workspace,COMPANION_RUNTIME_DIR:join(root,'state'),COMPANION_AUTOCONNECT:'0',CODEX_BIN:'/does-not-exist',KONNECT_BIN:'/does-not-exist'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  try {
    const url=`http://127.0.0.1:${port}`;let response;
    for(let i=0;i<80;i++){try{response=await fetch(url+'/api/state');if(response.ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
    assert.ok(response?.ok,output);const state=await response.json();
    assert.equal(state.instanceRoot,resolve('.'));assert.equal(state.workspace,workspace);
    assert.equal(state.board,null);assert.deepEqual(state.projects,[]);assert.deepEqual(state.messages,[]);assert.equal(state.agent.connected,false);
    assert.deepEqual(state.renders,[]);assert.deepEqual(state.permissions,[]);
    const post=(path,body)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post('/api/chat',{text:'hello',mode:'agent'})).status,400);
    assert.equal((await post('/internal/context',{})).status,403);
    assert.equal((await fetch(url+'/api/state',{headers:{Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await post('/api/project',{path:join(root,'unrelated.kicad_pcb')})).status,400);
  }finally{child.kill('SIGTERM');await once(child,'exit');}
});
