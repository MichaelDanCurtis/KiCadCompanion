// Isolated manual UI fixture; never imported by server/index.mjs or packaged as an adapter.
import express from 'express';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectStore,projectRoutes} from '../../server/projects.mjs';
import {ProductBriefStore,productBriefRoutes} from '../../server/product-briefs.mjs';
import {ActionGate} from '../../server/actions.mjs';
import {FixtureAdapter} from '../../server/adapters/fixture.mjs';
import {actionRoutes,projectTargetResolver} from '../../server/action-routes.mjs';
import {providerBoundary} from '../../server/provider-boundary.mjs';
import {readKiCadAppearance} from '../../server/appearance.mjs';
import {ProductProviderController,productProviderRoutes} from '../../server/provider-controller.mjs';
import {ProviderAccount} from '../../server/provider-account.mjs';
import {providerAccountRoutes} from '../../server/provider-account-routes.mjs';
const root=await mkdtemp(join(tmpdir(),'benchline-actions-ui-')),port=4332,app=express();
app.use((req,res,next)=>{if(req.headers.host!==`127.0.0.1:${port}`||(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`))return res.status(403).end();next();});app.use(express.json());
const briefs=new ProductBriefStore(join(root,'briefs.json'));await briefs.init();productBriefRoutes(app,briefs);
const projects=new ProjectStore({storageRoot:join(root,'models'),managedRoot:join(root,'products')});await projects.init();projectRoutes(app,projects,briefs);
let p=await projects.create({name:'TEST ONLY · Action controls'});p=await projects.addArtifact(p.manifest.id,p.manifest.revision,p.hash,{name:'Simulated firmware label',kind:'firmware',path:'label.txt',dependsOn:[]});
const adapters=new Map([['fixture',new FixtureAdapter()]]),gate=new ActionGate({path:join(root,'actions.json'),resolveTarget:projectTargetResolver(projects),adapters});await gate.init();actionRoutes(app,gate,adapters);
const productProvider=new ProductProviderController({gate});productProviderRoutes(app,productProvider);
const account=new ProviderAccount({binary:'/not-used-by-action-fixture',root:join(root,'account')});providerAccountRoutes(app,account);
const seeded=await gate.prepare({projectId:p.manifest.id,documentId:p.manifest.artifacts[0].id,adapter:'fixture',operation:'set-label',args:{value:'Verified UI example'},mode:'agent',idempotencyKey:randomUUID()});
if(process.argv.includes('--recovery')){
  const adapter=adapters.get('fixture'),execute=adapter.execute.bind(adapter);
  adapter.execute=async(...args)=>{await execute(...args);throw Error('TEST ONLY: response lost after simulated label update');};
  await gate.decide(seeded.id,'always');await gate.execute(seeded.id);adapter.execute=execute;
}
app.get('/api/appearance',async(req,res)=>res.json(await readKiCadAppearance()));
app.get('/api/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.flushHeaders();res.write(`data: ${JSON.stringify({type:'state',data:{projects:[],board:null,agent:{connected:false,busy:false},messages:[],surfaces:{},requests:[],activity:[],permissions:[],providerBoundary}})}\n\n`);});
app.use(express.static(resolve('dist')));app.get('/{*path}',(req,res)=>res.sendFile(resolve('dist/index.html')));app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));
const server=app.listen(port,'127.0.0.1',()=>console.log('Test-only action preview: http://127.0.0.1:'+port));
process.on('SIGTERM',async()=>{await productProvider.close();await account.disconnect();server.closeAllConnections();server.close();});
