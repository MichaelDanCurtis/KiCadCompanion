// Explicit opt-in UI harness; never imported by server/index.mjs.
import express from 'express';
import {createServer} from 'vite';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer as createHttpServer} from 'node:http';
import {productApprovalFixture} from './product-approval.mjs';
import {productProviderRoutes} from '../../server/provider-controller.mjs';
import {WorkspaceViews,workspaceViewRoutes,workspaceMutationGuard} from '../../server/workspace-views.mjs';
import {actionRoutes} from '../../server/action-routes.mjs';

if(process.argv[2]!=='--serve-disposable-fixture')throw Error('Explicit disposable fixture opt-in required');
const runs=[];
let callId=0;
const f=await productApprovalFixture({manifestHash:'f'.repeat(64),onTurn:async(rpc,identity,value)=>{
  const session=rpc.toolSession,run={...identity,value};runs.push(run);
  const call=(tool,args)=>session.handle({id:++callId,method:'item/tool/call',params:{
    ...identity,callId:`fixture-${callId}`,tool,arguments:args,
  }});
  try{
    const prepared=await call('benchline_prepare_action',{
      documentId:f.target.documentId,adapter:'fixture',operation:'set-label',args:{value},
    });
    run.prepared=prepared;
    const action=JSON.parse(prepared.contentItems[0].text);
    if(prepared.success&&action.state==='approved')run.executed=await call('benchline_execute_action',{actionId:action.actionId});
    const result=run.executed?JSON.parse(run.executed.contentItems[0].text):action;
    await session.handleEvent({method:'item/agentMessage/delta',params:{...identity,itemId:`message-${identity.turnId}`,
      delta:`Scripted fixture result: ${result.state||'cancelled or denied'}. This is not a model or native CAD result.`}});
    await session.handleEvent({method:'turn/completed',params:{threadId:identity.threadId,turn:{id:identity.turnId}}});
  }catch{run.error='Fixture callback failed';}
}});
const app=express();
let origin;
app.use((req,res,next)=>{
  if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return res.sendStatus(403);
  res.set('Cache-Control','no-store');next();
});
app.use(express.json({limit:'32kb'}));
const project={manifest:{id:f.scope.projectId,name:'Disposable approval fixture',revision:1,requirements:[],
  artifacts:[{id:f.target.documentId,name:'In-memory fixture label',kind:'fixture',path:'fixture.txt'}]},
  hash:f.scope.expectedManifestHash,local:{epoch:f.scope.expectedEpoch,history:[],observations:{[f.target.documentId]:{saved:{status:'saved',hash:'f'.repeat(64)},live:{status:'unavailable',revision:null,dirty:null,observedAt:null}}}},impact:{changed:[],downstream:[]},workspaceViews:true};
const views=new WorkspaceViews({projects:{open:async id=>{if(id!==f.scope.projectId)throw Error('Unknown fixture project');return structuredClone(project);}},quiesce:async()=>{await f.controller.close();await f.gate.pending;}});
app.use(workspaceMutationGuard({views:()=>views,gate:()=>f.gate,provider:()=>f.controller}));
workspaceViewRoutes(app,views);
app.get('/fixture/project',(req,res)=>res.json(project));
app.get('/fixture/evidence',(req,res)=>res.json({fixture:true,productionEnabled:false,modelUsed:false,
  value:f.adapter.value,dispatches:f.adapter.calls,runs,requests:f.requests,journal:f.gate.list(f.scope.projectId)}));
// Only this separate test server advertises fixture availability.
app.get('/api/provider/product/capabilities',(req,res)=>res.json({modes:{
  discuss:{supported:true},agent:{supported:true}}}));
productProviderRoutes(app,f.controller);actionRoutes(app,f.gate,f.gate.adapters);
const server=createHttpServer(app);
const vite=await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),
  server:{middlewareMode:true,hmr:{server}},appType:'custom'});
app.get('/',async(req,res)=>res.type('html').send(await vite.transformIndexHtml('/',
  '<!doctype html><html><head><link rel="icon" href="data:,"><title>Benchline approval fixture — TEST ONLY</title></head><body style="margin:0;background:#131b26"><div id="root"></div><script type="module" src="/tests/fixtures/product-approval-ui.jsx"></script></body></html>')));
app.use(vite.middlewares);
app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.message}));
server.listen(0,'127.0.0.1');await once(server,'listening');
origin=`http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({origin,pid:process.pid,evidence:join(f.root,'ui-evidence.json'),fixture:true}));
let closing=false;
async function close(){
  if(closing)return;closing=true;
  await f.controller.close();
  await writeFile(join(f.root,'ui-evidence.json'),JSON.stringify({fixture:true,modelUsed:false,productionEnabled:false,
    value:f.adapter.value,dispatches:f.adapter.calls,runs,requests:f.requests,journal:f.gate.list(f.scope.projectId)},null,2),{mode:0o600});
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await vite.close();
}
process.once('SIGINT',()=>close().catch(()=>{process.exitCode=1;}));
process.once('SIGTERM',()=>close().catch(()=>{process.exitCode=1;}));
