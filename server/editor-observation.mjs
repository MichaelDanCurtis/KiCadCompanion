// Read-only, host-pinned native observation. No action capabilities or saves.
import {z} from 'zod';
import {isAbsolute} from 'node:path';
import * as filesystem from 'node:fs/promises';
import {contentHash} from './projects.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {unpack} from './konnect.mjs';
import {ipcAddressSchema,observeKonnectBinding} from './adapters/konnect-binding.mjs';

const path=z.string().min(1).max(4096).refine(p=>isAbsolute(p)&&!/[\0\r\n]/.test(p));
const hash=z.string().regex(/^[a-f0-9]{64}$/),pin=z.object({path,sha256:hash}).strict();
export const editorObservationSchema=z.object({version:z.literal(1),board:path,ipc:ipcAddressSchema,nativeInstance:z.string().uuid(),binary:pin,config:pin,nativeRuntime:pin}).strict();
const contextSchema=z.object({experimental:z.literal(true),native_instance:z.string().uuid(),board:path,source:z.literal('ipc'),approval_granted:z.literal(false),revision_verified:z.literal(false)}).strict();
const diagnosticSchema=z.object({experimental:z.literal(true),native_instance:z.string().uuid(),revision:hash,dirty:z.boolean(),source:z.literal('ipc'),approval_granted:z.literal(false),inputs:z.object({filename:path,capture_version:z.literal(1)})});
async function connect(config){
  const client=new Client({name:'benchline-read-only-editor-observer',version:'1.0.0'});
  const transport=new StdioClientTransport({command:config.binary.path,args:['--config',config.config.path],env:{...(process.env.PATH?{PATH:process.env.PATH}:{}),KONNECT_ENABLE_EXPERIMENTAL_MODEL_UPDATE:'1'},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  try{await client.connect(transport);const call=async(name,args={})=>unpack(await client.callTool({name,arguments:args},undefined,{timeout:10000}));
    const catalog=await call('list_toolboxes');if(!catalog.toolsets?.some(s=>s.name==='experimental_models'))throw Error('Editor diagnostic unavailable');
    await call('load_toolset',{name:'experimental_models'});
    const allowed=new Set(['open_project','experimental_get_model_context','experimental_capture_board_diagnostic']);
    return {tools:(await client.listTools()).tools.filter(t=>allowed.has(t.name)),call:(name,args)=>{if(!allowed.has(name))throw Error('Read-only observer tool boundary');return call(name,args);},close:()=>client.close()};
  }catch(error){await client.close();throw error;}
}
export function createEditorObservation(raw,{connector=connect,io=filesystem,now=Date.now}={}){
  const parsed=editorObservationSchema.safeParse(raw);
  // The private native implementation is qualified only for this disposable family.
  const config=parsed.success&&/^\/private\/tmp\/benchline-native-live\.[^/]+\/fixtures\/BenchlineNativeTest\.kicad_pcb$/.test(parsed.data.board)?parsed.data:null;
  let connection,opening,closed=false,pending=Promise.resolve();
  async function pins(){if(!config||closed)throw Error('Editor observation unavailable');for(const entry of [config.binary,config.config,config.nativeRuntime]){if(!(await io.stat(entry.path)).isFile()||contentHash(await io.readFile(entry.path))!==entry.sha256)throw Error('Editor observation host changed');}}
  async function get(){await pins();if(connection)return connection;if(!opening)opening=(async()=>{const candidate=await connector(config);try{await pins();connection=candidate;return candidate;}catch(e){await candidate.close();throw e;}})().finally(()=>{opening=null;});return opening;}
  function observe(target){
    if(!config||closed||target.path!==config.board)return Promise.resolve(null);
    const next=pending.then(async()=>{try{
      const k=await get();if(!['open_project','experimental_get_model_context','experimental_capture_board_diagnostic'].every(name=>k.tools.some(t=>t.name===name)))return null;
      await observeKonnectBinding(k,target,config.ipc);
      const context=contextSchema.parse(await k.call('experimental_get_model_context',{board:config.board}));
      if(context.native_instance!==config.nativeInstance||context.board!==config.board)return null;
      const result=diagnosticSchema.parse(await k.call('experimental_capture_board_diagnostic',{board:config.board,native_instance:config.nativeInstance}));
      if(closed||result.native_instance!==config.nativeInstance||result.inputs.filename!==target.path)return null;
      return {...target,revision:result.revision,dirty:result.dirty,observedAt:new Date(now()).toISOString()};
    }catch{return null;}});pending=next.catch(()=>{});return next;
  }
  return {observe,configured:!!config,close:async()=>{closed=true;await pending;await opening?.catch(()=>{});await connection?.close();connection=null;}};
}
