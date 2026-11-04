import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { briefSchema, briefProblems, proposePlan } from '../shared/product-brief.mjs';

const planSchema=z.object({version:z.literal(1),generator:z.literal('local-rules'),executionEnabled:z.literal(false),approach:z.array(z.string()),decisions:z.array(z.object({field:z.string(),label:z.string(),reason:z.string()})),tasks:z.array(z.object({id:z.string(),title:z.string(),discipline:z.string(),tool:z.string(),dependsOn:z.array(z.string()),output:z.string(),check:z.string()}))}).strict();
const recordSchema=z.object({id:z.string().uuid(),revision:z.number().int().positive(),createdAt:z.string(),updatedAt:z.string(),brief:briefSchema,plan:planSchema,approvedRevision:z.number().int().positive().nullable(),approvedAt:z.string().nullable(),history:z.array(z.object({revision:z.number().int().positive(),brief:briefSchema,plan:planSchema,approvedAt:z.string().nullable()}).strict()).max(100)}).strict().refine(r=>(r.approvedRevision===null&&r.approvedAt===null)||(r.approvedRevision===r.revision&&r.approvedAt!==null),'Approval must match the current brief revision');
const diskSchema=z.object({schemaVersion:z.literal(1),records:z.array(recordSchema).max(100)}).strict();
export class ProductBriefStore {
  constructor(path,{write=writeFile}={}) {this.path=path;this.write=write;this.records=[];this.pending=Promise.resolve();}
  async init() {
    try {this.records=diskSchema.parse(JSON.parse(await readFile(this.path,'utf8'))).records;}
    catch(e){if(e.code!=='ENOENT')throw new Error(`Product briefs could not be loaded; original file preserved: ${e.message}`);}
  }
  view(record){return structuredClone(record);}
  list(){return this.records.map(r=>this.view(r)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  transact(operation){
    const result=this.pending.then(async()=>{
      const records=structuredClone(this.records),record=operation(records);
      await mkdir(dirname(this.path),{recursive:true,mode:0o700});
      await this.write(this.path+'.tmp',JSON.stringify({schemaVersion:1,records},null,2)+'\n',{mode:0o600});
      await rename(this.path+'.tmp',this.path);
      this.records=records;return this.view(record);
    });
    this.pending=result.catch(()=>{});return result;
  }
  create(input){const brief=briefSchema.parse(input);return this.transact(records=>{
    if(records.length>=100)throw new Error('This preview supports up to 100 briefs per workspace. Export/archive support is pending.');
    const now=new Date().toISOString(),r={id:randomUUID(),revision:1,createdAt:now,updatedAt:now,brief,plan:proposePlan(brief),approvedRevision:null,approvedAt:null,history:[]};records.push(r);return r;
  });}
  change(id,revision,operation){return this.transact(records=>{
    const r=records.find(r=>r.id===id);if(!r)throw Object.assign(new Error('Product brief not found'),{status:404});
    if(r.revision!==revision)throw Object.assign(new Error('This brief changed in another window. Your edits are still here; reload the saved revision before replacing them.'),{status:409});
    return operation(r);
  });}
  update(id,revision,input){const brief=briefSchema.parse(input);return this.change(id,revision,r=>{
    if(JSON.stringify(brief)===JSON.stringify(r.brief))return r;
    if(r.history.length>=100)throw new Error('Revision history limit reached. Nothing was overwritten.');
    r.history.push({revision:r.revision,brief:r.brief,plan:r.plan,approvedAt:r.approvedAt});
    Object.assign(r,{brief,plan:proposePlan(brief),revision:r.revision+1,approvedRevision:null,approvedAt:null,updatedAt:new Date().toISOString()});return r;
  });}
  approve(id,revision){return this.change(id,revision,r=>{
    const problems=briefProblems(r.brief);if(problems.length)throw new Error(problems.join(' '));
    r.approvedRevision=r.revision;r.approvedAt=new Date().toISOString();r.updatedAt=r.approvedAt;return r;
  });}
}

export function productBriefRoutes(app,store){
  const version=z.number().int().positive();
  app.get('/api/product-briefs',(req,res)=>res.json({records:store.list(),executionEnabled:false}));
  app.post('/api/product-briefs',async(req,res)=>res.status(201).json(await store.create(req.body.brief)));
  app.post('/api/product-briefs/:id/update',async(req,res)=>res.json(await store.update(z.string().uuid().parse(req.params.id),version.parse(req.body.expectedRevision),req.body.brief)));
  app.post('/api/product-briefs/:id/approve',async(req,res)=>{
    if(req.body.scope!=='plan-only')throw new Error('Approval must explicitly be plan-only; no tool execution is authorized');
    res.json(await store.approve(z.string().uuid().parse(req.params.id),version.parse(req.body.expectedRevision)));
  });
}
