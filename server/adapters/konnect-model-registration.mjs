// Host-owned registration for the qualified disposable model-assignment scope.
// This does not qualify customer boards or restore the ordinary footprint updater.
import {createHash} from 'node:crypto';
import * as filesystem from 'node:fs/promises';
import {isAbsolute, relative, sep} from 'node:path';
import {z} from 'zod';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {KonnectModelsAdapter} from './konnect-models.mjs';
import {ipcAddressSchema} from './konnect-binding.mjs';
import {unpack} from '../konnect.mjs';

const path=z.string().min(1).max(4096).refine(value=>isAbsolute(value)&&!/[\0\r\n]/.test(value));
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const pin=z.object({path,sha256:hash}).strict();
export const konnectModelRegistrationSchema=z.object({
  qualification:z.object({diagnostic:z.boolean().optional(),board:path,savedSha256:hash,
    ipc:ipcAddressSchema,nativeInstance:z.string().uuid(),binary:path,binarySha256:hash,
    config:path,model:path,footprints:z.array(z.string().uuid()).min(1).max(128)
      .refine(items=>new Set(items).size===items.length)}).strict(),
  configSha256:hash,nativeRuntime:pin,modelSha256:hash,modelRoots:z.array(path).min(1).max(16),
}).strict();
const denied=()=>Error('Native model registration is unsupported or its qualification changed');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const allowedTools=new Set(['open_project','experimental_get_model_context',
  'experimental_preview_placed_models','experimental_apply_placed_models','experimental_inspect_model_result']);

async function connectNative(q){
  const client=new Client({name:'benchline-qualified-model-adapter',version:'1.0.0'});
  const transport=new StdioClientTransport({command:q.binary,args:['--config',q.config],
    env:{...(process.env.PATH?{PATH:process.env.PATH}:{}),KONNECT_ENABLE_EXPERIMENTAL_MODEL_UPDATE:'1'},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  try{
    await client.connect(transport);
    const call=async(name,args={})=>unpack(await client.callTool({name,arguments:args},undefined,{timeout:30000}));
    const catalog=await call('list_toolboxes');
    if(!catalog.toolsets?.some(item=>item.name==='experimental_models'))throw denied();
    await call('load_toolset',{name:'experimental_models'});
    return {tools:(await client.listTools()).tools,call,close:()=>client.close()};
  }catch(error){await client.close();throw error;}
}

/** Configuration and connector are trusted host dependencies, never HTTP/model input.
 * Connector/filesystem overrides are for synthetic tests; normal use omits them.
 * Missing/drifted pins yield a permanently unsupported registration, no fallback.
 */
export async function createKonnectModelRegistration(configuration,{connect=connectNative,io=filesystem}={}){
  let supported=false,connection=null,opening=null,closed=false,adapter;
  const parsed=konnectModelRegistrationSchema.safeParse(configuration);
  const refuse=()=>{throw denied();};
  const unsupported={version:1,capabilities:()=>[{operation:'set-placed-models',version:1,effect:'write',supported:false,
    reason:'Native model assignment requires an unchanged qualified host binding'}],
    validate:refuse,observe:refuse,preview:refuse,execute:refuse,verify:refuse,inspect:refuse,reviewRecovery:refuse,
    cancel:async()=>({supported:false,reason:'No qualified native dispatch; stop future work only'})};
  const status=()=>({supported:supported&&!closed,scope:'qualified-disposable-model-assignment',
    ...(supported&&!closed?{}:{reason:'Native model assignment requires an unchanged qualified host binding'})});
  const close=async()=>{closed=true;supported=false;if(adapter)adapter.enabled=false;
    const current=connection;connection=null;await current?.close();
    // Await a late connector; its generation cannot revive a closed registration.
    await opening?.catch(()=>{});
  };
  const result=()=>({adapter:adapter??unsupported,status,close});
  if(!parsed.success)return result();
  const config=parsed.data,q=config.qualification;
  // Current live evidence proves this disposable family only, not arbitrary boards.
  if(!/^\/private\/tmp\/benchline-native-live\.[^/]+\/fixtures\/BenchlineNativeTest\.kicad_pcb$/.test(q.board))return result();
  const invalidate=()=>{supported=false;if(adapter)adapter.enabled=false;};
  const checkedFile=async(p,expected)=>{
    if(!(await io.stat(p)).isFile()||sha(await io.readFile(p))!==expected)throw denied();
  };
  const assertPins=async()=>{
    if(closed)throw denied();
    try{
      await checkedFile(q.binary,q.binarySha256);
      await checkedFile(q.config,config.configSha256);
      await checkedFile(config.nativeRuntime.path,config.nativeRuntime.sha256);
      await checkedFile(q.board,q.savedSha256);
      const model=await io.realpath(q.model);
      await checkedFile(model,config.modelSha256);
      const roots=await Promise.all(config.modelRoots.map(root=>io.realpath(root)));
      if(!roots.some(root=>{const child=relative(root,model);return child&&!isAbsolute(child)&&child!=='..'&&!child.startsWith('..'+sep);}))throw denied();
    }catch{invalidate();throw denied();}
  };
  const getConnection=async()=>{
    if(!supported)throw denied();
    await assertPins();
    if(!supported||closed)throw denied();
    if(connection)return connection;
    if(!opening)opening=(async()=>{
      const candidate=await connect(structuredClone(q));
      try{
        await assertPins();
        if(!supported||!Array.isArray(candidate.tools)||![...allowedTools].every(name=>candidate.tools.some(tool=>tool.name===name)))throw denied();
        connection={tools:candidate.tools.filter(tool=>allowedTools.has(tool.name)),close:()=>candidate.close(),
          call:async(name,args)=>{if(!supported||!allowedTools.has(name))throw denied();await assertPins();
            if(!supported||closed)throw denied();return candidate.call(name,args);}};
        return connection;
      }catch(error){invalidate();await candidate.close();throw error;}
    })().finally(()=>{opening=null;});
    return opening;
  };
  class QualifiedAdapter extends KonnectModelsAdapter{
    validate(operation,args){
      const value=super.validate(operation,args);
      if(!supported||closed||value.replacements.some(item=>!q.footprints.includes(item.footprint)||
        item.models.some(model=>model.filename!==q.model)))throw denied();
      return value;
    }
    async bound(target){
      if(target.path!==q.board)throw denied();
      try{return await super.bound(target);}catch{invalidate();throw denied();}
    }
  }
  try{
    await assertPins();supported=true;
    adapter=new QualifiedAdapter({connection:getConnection,expectedIpcAddress:q.ipc,nativeInstance:q.nativeInstance,enabled:true});
    // Discovery/read-only native identity check must precede advertising support.
    await adapter.bound({path:q.board});
  }catch{invalidate();await connection?.close();connection=null;}
  return result();
}
