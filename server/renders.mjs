import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { config } from './config.mjs';

export const renderOptions = z.object({
  camera: z.enum(['perspective', 'top', 'bottom']).default('perspective'),
  color: z.enum(['kicad', 'white', 'black', 'green', 'red']).default('kicad'),
  quality: z.enum(['basic', 'high']).default('basic'),
}).strict();
const cli = config.cli;
const python = config.modelPython;
const mask = {white:'rgba(235, 237, 230, 0.96)',black:'rgba(22, 25, 29, 0.96)',green:'rgba(20, 104, 54, 0.88)',red:'rgba(163, 25, 32, 0.92)'};
export function viewerConfig(color) {
  return {meta:{version:4}, layer_presets:[{name:'companion-render',
    layers:['board','copper','copper_bottom','plated_barrels','silkscreen_top','silkscreen_bottom','soldermask_top','soldermask_bottom','solderpaste','th_models','smd_models','virtual_models','non_pos_file_models','fp_references','fp_values','fp_text'],
    colors: [
      {layer:'background_top',color:'rgb(42, 47, 55)'},{layer:'background_bottom',color:'rgb(90, 97, 108)'},
      {layer:'board',color:'rgba(100, 76, 35, 0.95)'},
      ...['copper','copper_bottom'].map(layer=>({layer,color:'rgb(190, 160, 75)'})),
      {layer:'solderpaste',color:'rgb(190, 193, 198)'},
      ...['soldermask_top','soldermask_bottom'].map(layer=>({layer,color:mask[color]||mask.green})),
      ...['silkscreen_top','silkscreen_bottom'].map(layer=>({layer,color:color==='white'?'rgb(25, 25, 25)':'rgb(235, 235, 235)'})),
    ]}]};
}
export async function fingerprint(board) {
  const before = await stat(board);
  const sha256 = createHash('sha256').update(await readFile(board)).digest('hex');
  const after = await stat(board);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('Board was being saved; try again');
  return {sha256, fileModifiedAt:after.mtime.toISOString()};
}
export function pngBytes(value) {
  if (typeof value !== 'string' || value.length > 90e6) throw new Error('Invalid generated image');
  const encoded = value.replace(/^data:image\/png;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(encoded)) throw new Error('Expected a base64 PNG result');
  const bytes = Buffer.from(encoded,'base64');
  if (!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) throw new Error('Image is not a PNG');
  return bytes;
}
export class RenderStore {
  constructor({root,appRoot,onChange=()=>{}}) {Object.assign(this,{root,appRoot,onChange});this.jobs=[];this.pending=false;}
  async init() {
    await mkdir(this.root,{recursive:true});
    for (const dir of await readdir(this.root)) {
      if (!/^[0-9a-f-]{36}$/.test(dir)) continue;
      try {const job=JSON.parse(await readFile(join(this.root,dir,'manifest.json'),'utf8'));if(job.id===dir){
        if(['running','queued'].includes(job.status)) {job.status='failed';job.error='Rendering was interrupted by a restart';}
        if(job.ai?.status==='running') job.ai={...job.ai,status:'failed',error:'Generation interrupted by a restart'};
        this.jobs.push(job);
      }}catch{}
    }
    this.jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  list(board) {return this.jobs.filter(j=>j.board===board).slice(0,20);}
  get(id) {const job=this.jobs.find(j=>j.id===id);if(!job)throw new Error('Unknown render');return job;}
  path(id,kind='actual') {this.get(id);if(!['actual','ai'].includes(kind))throw new Error('Unknown image kind');return join(this.root,id,`${kind}.png`);}
  async save(job) {
    const path=join(this.root,job.id,'manifest.json'),temporary=path+`.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify(job,null,2),{mode:0o600});await rename(temporary,path);this.onChange(job);
  }
  run(binary,args,env) {
    return new Promise((resolve,reject)=>{
      const child=spawn(binary,args,{env,stdio:['ignore','pipe','pipe']});this.child=child;
      let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('Renderer timed out after 3 minutes'));},180000);
      for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output=(output+b).slice(-40000)});
      child.on('error',e=>{clearTimeout(timer);reject(e)});
      child.on('close',code=>{clearTimeout(timer);if(this.child===child)this.child=null;code===0?resolve(output):reject(new Error(output.slice(-1600)||`Renderer exited ${code}`))});
    });
  }
  async start(board,options) {
    options=renderOptions.parse(options);
    if(this.pending)throw new Error('A local render is already running');
    this.pending=true;
    try {
      const source=await fingerprint(board);
      const job={id:randomUUID(),board,options,source,createdAt:new Date().toISOString(),status:'queued',stage:'Preparing saved-board render'};
      await mkdir(join(this.root,job.id),{recursive:true});this.jobs.unshift(job);await this.save(job);
      this.perform(job).catch(async e=>{job.status='failed';job.error=e.message;await this.save(job)}).finally(()=>{this.pending=false});
      return job;
    }catch(e){this.pending=false;throw e}
  }
  async perform(job) {
    const configRoot=join(this.root,job.id,'config');
    await mkdir(join(configRoot,'10.0'),{recursive:true});
    // Process-local appearance preset. No changes to the PCB, stackup or user's preferences.
    await writeFile(join(configRoot,'10.0','3d_viewer.json'),JSON.stringify(viewerConfig(job.options.color)));
    let configured={};try{configured=JSON.parse(await readFile(join(config.kiCadConfigDir,'kicad_common.json'),'utf8')).environment?.vars||{}}catch{}
    const env={...process.env,...Object.fromEntries(Object.entries(configured).filter(([,v])=>typeof v==='string')),KICAD_CONFIG_HOME:configRoot,KIPRJMOD:dirname(job.board)};
    if(config.modelDir)for(const version of [6,7,8,9,10])env[`KICAD${version}_3DMODEL_DIR`] ||= config.modelDir;
    job.status='running';job.stage='Checking component model assignments';await this.save(job);
    try {const log=await this.run(process.env.KICAD_PYTHON||python,[join(this.appRoot,'server/model-audit.py'),job.board],env);
      job.models=JSON.parse(log.trim().split('\n').findLast(line=>line.startsWith('{')));
      if(job.models.schemaVersion!==2)throw new Error('Unsupported model coverage format');
    }catch(e){job.models={error:`Model coverage could not be verified: ${e.message}`};}
    job.stage='Ray tracing in KiCad';await this.save(job);
    const args=['pcb','render',job.board,'-o',this.path(job.id),'--width','1600','--height','1000','--quality',job.options.quality,'--background','opaque'];
    args.push('--preset','companion-render');
    if(job.options.color==='kicad')args.push('--use-board-stackup-colors');
    args.push('--side',job.options.camera==='bottom'?'bottom':'top');
    if(job.options.camera==='perspective')args.push('--perspective','--rotate','325,0,30','--zoom','0.7');
    job.log=await this.run(process.env.KICAD_CLI||cli,args,env);
    pngBytes((await readFile(this.path(job.id))).toString('base64'));
    if(job.models.schemaVersion===2){
      const log=await this.run(process.env.KICAD_PYTHON||python,[join(this.appRoot,'server/model-audit.py'),job.board],env);
      const after=JSON.parse(log.trim().split('\n').findLast(line=>line.startsWith('{')));
      if(JSON.stringify(after)!==JSON.stringify(job.models))throw new Error('Model assignments or files changed during rendering. Discarded result; render again.');
      job.modelInputsVerified=true;
    }
    if((await fingerprint(job.board)).sha256!==job.source.sha256)throw new Error('Board changed during rendering. Discarded result; render again.');
    job.status='completed';job.stage='Ready';job.completedAt=new Date().toISOString();await this.save(job);
  }
  async receiveAI(id,item) {
    const job=this.get(id);
    // App Server returns base64 for imageGeneration; never serve arbitrary model-supplied paths.
    const bytes=pngBytes(item.result);
    await writeFile(this.path(id,'ai'),bytes,{mode:0o600});
    job.ai={...job.ai,status:'completed',completedAt:new Date().toISOString(),revisedPrompt:item.revisedPrompt||null};await this.save(job);
  }
  close(){this.child?.kill();}
}
