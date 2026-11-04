import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {providerResultSchema} from '../../shared/provider-results.mjs';
import {ipcAddressSchema,observeKonnectBinding} from './konnect-binding.mjs';

// Conservative conformance adapter. Mutation is NOT enabled from tool annotations
// or the presence of an expected_plan_revision input alone.
export class KonnectAdapter {
  version=1;
  constructor({connection,expectedIpcAddress=null}){this.connection=connection;this.expectedIpcAddress=expectedIpcAddress===null?null:ipcAddressSchema.parse(expectedIpcAddress);}
  capabilities(){return [
    {operation:'board-info',version:1,effect:'read',supported:true},
    {operation:'refresh-footprints',version:1,effect:'write',supported:false,reason:'Atomic native revision precondition not established; apply/preservation/recovery conformance pending'},
  ];}
  validate(operation,args){if(operation!=='board-info')throw Error('Native mutation unsupported');return z.object({}).strict().parse(args);}
  async hash(path){return createHash('sha256').update(await readFile(path)).digest('hex');}
  async observe(target,input){if(!target.path.endsWith('.kicad_pcb'))throw Error('Not a PCB document');const k=await this.connection();
    if(!k.tools?.some(t=>t.name==='get_board_info'))throw Error('Konnect board-info capability unavailable');
    if(this.expectedIpcAddress)await observeKonnectBinding(k,target,this.expectedIpcAddress);
    return {projectId:input.projectId,documentId:input.documentId,path:target.path,revision:await this.hash(target.path),observedAt:Date.now(),connected:true};
  }
  async preview(target,input,observation){return {revision:observation.revision,
    summary:this.expectedIpcAddress?'Read board metadata from the explicitly bound live editor. Saved-file hash does not cover unsaved editor state.':'Read board metadata, allowing file fallback. Saved-file hash does not cover unsaved editor state.',
    confirmation:'Read-only Konnect board metadata v1'+(this.expectedIpcAddress?' live '+this.expectedIpcAddress:' automatic source')};}
  async execute(target,input,observation){this.validate(input.operation,input.args);if(await this.hash(target.path)!==observation.revision)throw Error('Saved board changed');const k=await this.connection();
    const binding=this.expectedIpcAddress?await observeKonnectBinding(k,target,this.expectedIpcAddress):null;
    const result=await k.call('get_board_info',{board:target.path});
    return {result,savedHash:observation.revision,liveRevision:null,dirty:null,source:result.source||'unreported',binding};
  }
  projectResult(target,input,receipt){
    this.validate(input.operation,input.args);
    const r=receipt?.result;
    if(r?.file!==target.path)throw Error('Read response document mismatch');
    if(this.expectedIpcAddress&&(r.source!=='ipc'||receipt.binding?.ipcAddress!==this.expectedIpcAddress||receipt.binding?.documentPath!==target.path))throw Error('Live read binding unavailable');
    return providerResultSchema.parse({schemaVersion:1,kind:'board-metadata',
      title:r.title,company:r.company,date:r.date,designRevision:r.revision,
      copperLayerCount:r.copper_layer_count,layerCount:r.layer_count,netCount:r.net_count,
      paper:r.paper,paperSizeMm:r.paper_size_mm,
      provenance:{source:r.source,savedHash:receipt.savedHash,liveRevision:null,dirty:null,
        scope:'Read snapshot; saved file unchanged at verification. Live revision and dirty state unknown. Paper metadata comes from the file.',
        contentIsUntrusted:true},
    });
  }
  async verify(target,input,receipt){
    let valid=false;
    try{this.projectResult(target,input,receipt);
      if(this.expectedIpcAddress)await observeKonnectBinding(await this.connection(),target,this.expectedIpcAddress);
      valid=true;}catch{}
    return {verified:valid&&await this.hash(target.path)===receipt.savedHash,scope:'Matching, schema-checked read response and saved file unchanged; not a live revision or design validation'};
  }
  async cancel(){return {supported:false,reason:'Already dispatched MCP requests cannot be rolled back; stop future work only'};}
  async inspect(target){return {savedHash:await this.hash(target.path),liveRevision:null,dirty:null,doesNotAuthorizeReplay:true};}
  async reviewRecovery(target,action){
    if(action.effect!=='read'||action.input.operation!=='board-info')throw Error('Native mutation recovery unsupported');
    const observation=await this.observe(target,action.input),receipt=await this.execute(target,action.input,observation);
    if(!(await this.verify(target,action.input,receipt)).verified)throw Error('Current native read could not be verified');
    return {version:1,revision:receipt.savedHash,basis:'read-only-operation',
      summary:'A new metadata inspection succeeded. The original read outcome remains unknown; no mutation was authorized.',
      details:this.projectResult(target,action.input,receipt)};
  }
}
