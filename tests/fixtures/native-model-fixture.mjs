// Test-only connection helper. No global configuration or customer-file access.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {KonnectModelsAdapter} from '../../server/adapters/konnect-models.mjs';
import {unpack} from '../../server/konnect.mjs';

export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function openNativeModelFixture(q){
  assert.match(q.board,/^\/private\/tmp\/benchline-native-live\.[^/]+\/fixtures\/BenchlineNativeTest\.kicad_pcb$/);
  assert.ok([q.binary,q.config,q.model].every(isAbsolute));
  assert.equal(sha(await readFile(q.binary)),q.binarySha256);
  assert.equal(sha(await readFile(q.board)),q.savedSha256);
  await readFile(q.model);
  assert.equal(q.footprints.length,2);assert.equal(new Set(q.footprints).size,2);
  const client=new Client({name:'benchline-native-process-qualification',version:'1.0.0'});
  const transport=new StdioClientTransport({command:q.binary,args:['--config',q.config],
    env:{PATH:process.env.PATH,KONNECT_ENABLE_EXPERIMENTAL_MODEL_UPDATE:'1'},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  let applyCalls=0;
  try {
    await client.connect(transport);
    const direct=async(name,args={})=>unpack(await client.callTool({name,arguments:args},undefined,{timeout:30000}));
    const catalog=await direct('list_toolboxes');
    assert.equal(catalog.toolsets.find(t=>t.name==='experimental_models')?.tool_count,q.diagnostic===true?6:5);
    await direct('load_toolset',{name:'experimental_models'});
    const k={tools:(await client.listTools()).tools,call:async(name,args)=>{
      if(name==='experimental_apply_placed_models')assert.equal(++applyCalls,1,'One native write per worker/connection');
      return direct(name,args);
    }};
    const adapter=new KonnectModelsAdapter({connection:async()=>k,expectedIpcAddress:q.ipc,nativeInstance:q.nativeInstance,enabled:true});
    return {adapter,pid:transport.pid,close:()=>client.close(),calls:()=>applyCalls,
      diagnostic:async()=>{
        assert.equal(q.diagnostic,true,'Diagnostic capability must be explicitly qualified');
        assert.ok(k.tools.some(t=>t.name==='experimental_capture_board_diagnostic'));
        await adapter.bound({path:q.board});
        return direct('experimental_capture_board_diagnostic',{board:q.board,native_instance:q.nativeInstance});
      }};
  }catch(error){await client.close();throw error;}
}
export function fixtureInput(q,target,models){return {projectId:target.projectId,documentId:target.documentId,
  adapter:'native-models',operation:'set-placed-models',args:{replacements:q.footprints.map(footprint=>({footprint,models}))},
  mode:'agent',idempotencyKey:randomUUID()};}
export const fixtureModel=q=>({filename:q.model,scale:{x:1,y:1,z:1},rotation:{x:0,y:0,z:0},offset:{x:0,y:0,z:0},visible:true,opacity:1});
