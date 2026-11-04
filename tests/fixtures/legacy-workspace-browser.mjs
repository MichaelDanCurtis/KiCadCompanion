// Explicit presentation regression of the actual built app with synthetic data.
// No production backend, CAD file, account, model, renderer, or provider is used.
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {visualMessages} from '../../shared/visuals.mjs';
import {DEFAULT_BOARD_PALETTE} from '../../shared/appearance.mjs';

const [flag,packagePath,executablePath,output]=process.argv.slice(2);
assert.ok(['--run-disposable','--run-disposable-headed'].includes(flag));
const headed=flag.endsWith('-headed');
if(headed)assert.equal(process.stdin.isTTY,true,'Native zoom recording requires an interactive terminal.');
assert.ok([packagePath,executablePath,output].every(p=>p&&resolve(p)===p));
const {chromium}=await import(pathToFileURL(join(packagePath,'index.mjs')));
await mkdir(output,{recursive:true});
const board='/fixture/synthetic.kicad_pcb',source='Synthetic UI fixture only — no engineering or generated-image evidence';
const component=(reference,x)=>({id:reference,reference,value:'Synthetic part',footprint:'Fixture',x,y:10,rotation:0,layer:'BL_F_Cu',pads:[{id:reference+'-1',number:'1',net:'FIXTURE',x,y:10}]});
const render=(id,camera)=>({id,board,status:'completed',createdAt:'2026-09-10T00:00:00Z',options:{camera,color:'white'},source:{sha256:'f'.repeat(64),fileModifiedAt:'2026-09-10T00:00:00Z'},models:{source,components:[{reference:'R1',models:[{exists:true,visible:true}]},{reference:'R2',models:[]}]}});
const state={board,projects:[{path:board,name:'Synthetic UI fixture'}],status:'live',observedAt:new Date().toISOString(),projectSelected:true,
  agent:{connected:false,busy:true,imageGeneration:false},messages:[{id:'fixture-message',role:'system',text:source}],activity:[],permissions:[{key:'fixture-rule',label:'Fixture selection',detail:'Synthetic permission display; no action authority'}],
  live:{components:[component('R1',10),component('R2',20)],selection:[],shapes:[],tracks:[],netCount:1,copperLayers:2},
  requests:[{id:'fixture-approval',method:'item/commandExecution/requestApproval',params:{reason:'Synthetic pending approval for layout inspection only'},approval:{label:'Fixture action',detail:'Synthetic document scope; no tool dispatch'}}],
  renders:[render('fixture-new','top'),{...render('fixture-old','bottom'),ai:{status:'completed',completedAt:'2026-09-10T00:00:00Z'}}],surfaces:{}};
for(const [id,kind,spec] of [
  ['fixture-chart','Chart',{title:'Fixture component chart',source,type:'bar',unit:'items',data:[{label:'R1',value:1,reference:'R1'}]}],
  ['fixture-line','Chart',{title:'Fixture line chart',source,type:'line',unit:'V',data:[{label:'Sample one',value:1},{label:'Sample two',value:2}]}],
  ['fixture-table','DataTable',{title:'Fixture parts table',source,columns:['Reference','Value'],rows:[['R1','Synthetic part']]}],
  ['fixture-network','Network',{title:'Fixture connection graph',source,nodes:[{id:'one',label:'R2 synthetic node',reference:'R2'},{id:'two',label:'Fixture node'}],edges:[{from:'one',to:'two',label:'Synthetic link'}]}],
])state.surfaces[id]=visualMessages({id,kind,spec});
const evidence={timestamp:new Date().toISOString(),presentationFixture:true,modelUsed:false,nativeUsed:false,renderGenerated:false,checks:[],requests:[],errors:[]};
const app=express(),streams=new Set();let origin,browser;
app.use((req,res,next)=>{if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return res.sendStatus(403);res.set('Cache-Control','no-store');next();});
app.use(express.json());
app.get('/favicon.ico',(req,res)=>res.status(204).end());
const emit=()=>{state.observedAt=new Date().toISOString();for(const stream of streams)stream.write(`data: ${JSON.stringify({type:'state',data:state})}\n\n`);};
app.get('/api/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Connection':'keep-alive'});res.flushHeaders();streams.add(res);emit();req.on('close',()=>streams.delete(res));});
app.get('/api/appearance',(req,res)=>res.json({name:'Synthetic fixture palette',palette:DEFAULT_BOARD_PALETTE,note:source}));
app.get('/api/product-briefs',(req,res)=>res.json({records:[]}));
app.get('/api/product-projects',(req,res)=>res.json({projects:[]}));
app.get('/api/provider/account',(req,res)=>res.json({phase:'disconnected',signedIn:false}));
app.post('/api/select',(req,res)=>{evidence.requests.push({path:req.path,body:req.body});state.live.selection=[req.body.reference];emit();res.json({fixture:true});});
app.post('/api/permissions/revoke',(req,res)=>{evidence.requests.push({path:req.path,body:req.body});state.permissions=[];emit();res.json({fixture:true});});
app.get('/api/renders/:id/:file',(req,res)=>res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#304047"/><text x="30" y="180" fill="white" font-size="24">Synthetic image fixture — no rendered geometry</text></svg>'));
app.use('/api',(req,res)=>{evidence.errors.push(`Unexpected API ${req.method} ${req.path}`);res.status(400).json({error:'Unavailable in presentation fixture'});});
app.use(express.static(resolve('dist')));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
const heartbeat=setInterval(emit,1500);
async function check(name,fn){await fn();evidence.checks.push(name);console.log(name);}
async function reachable(locator){await locator.scrollIntoViewIfNeeded();assert.equal(await locator.isVisible(),true);assert.ok(await locator.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,top=document.elementFromPoint(x,y);return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&(top===el||el.contains(top));}),`Unreachable: ${await locator.getAttribute('aria-label')||await locator.textContent()}`);}
try{
  browser=await chromium.launch({headless:!headed,executablePath});evidence.browser=browser.version();evidence.node=process.version;
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>evidence.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')evidence.errors.push(m.text());});
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Electronics',exact:true}).first().click();
  await check('Theme and board appearance remain selectable and persist across reload',async()=>{
    await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByLabel('Interface theme').selectOption('original');
    assert.equal(await page.locator('.app').getAttribute('data-theme'),'original');await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'White board look',exact:true}).click();await page.reload({waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Electronics',exact:true}).first().click();assert.equal(await page.locator('.app').getAttribute('data-theme'),'original');
    assert.equal(await page.getByRole('button',{name:'White board look',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByLabel('Interface theme').selectOption('kicad');await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.emulateMedia({colorScheme:'light'});await page.screenshot({path:join(output,'light-theme.png')});
    const light=await page.locator('.app').evaluate(el=>getComputedStyle(el).backgroundColor);await page.emulateMedia({colorScheme:'dark'});
    assert.notEqual(await page.locator('.app').evaluate(el=>getComputedStyle(el).backgroundColor),light);
  });
  await check('Actual A2UI chart, table and graph render and dispatch reference selections',async()=>{
    await page.getByRole('button',{name:/^Visuals/}).click();await page.getByRole('heading',{name:'Fixture component chart',exact:true}).waitFor();
    await page.getByTitle('R1: 1 items',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.context-chip')?.textContent.includes('R1 selected'));
    await page.getByRole('heading',{name:'Fixture parts table',exact:true}).waitFor();assert.match(await page.locator('.visuals-pane table').innerText(),/R1\s+Synthetic part/);
    await page.getByRole('button',{name:'R2 synthetic node',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.context-chip')?.textContent.includes('R2 selected'));
    await page.getByRole('img',{name:'Fixture line chart',exact:true}).locator('circle').first().hover();await page.locator('p.source').filter({hasText:/^Sample one: 1 V$/}).waitFor();
    await page.screenshot({path:join(output,'a2ui.png')});
  });
  await check('Render history retains saved versus illustrative labels, source warnings and separate download targets',async()=>{
    await page.getByRole('button',{name:'Render',exact:true}).click();await page.getByText('SAVED SNAPSHOT',{exact:true}).waitFor();await page.getByText('ILLUSTRATIVE',{exact:true}).waitFor();
    await page.getByLabel('Render history').selectOption('fixture-old');await page.getByAltText('AI-generated studio interpretation, not an engineering reference').waitFor();
    assert.match(await page.locator('.render-evidence').innerText(),/1 of 2 footprints/);assert.match(await page.locator('.render-evidence').innerText(),/R2/);
    assert.equal(await page.getByRole('button',{name:'Generate AI studio image',exact:true}).isEnabled(),false);
    assert.match(await page.locator('.render-card:not(.ai) footer a').getAttribute('href'),/fixture-old\/actual.png/);assert.match(await page.locator('.render-card.ai footer a').getAttribute('href'),/fixture-old\/ai.png/);
    await page.getByLabel('Render history').selectOption('fixture-new');assert.equal(await page.getByAltText('AI-generated studio interpretation, not an engineering reference').count(),0);
    await page.getByRole('button',{name:'Latest AI comparison',exact:true}).click();await page.getByAltText('AI-generated studio interpretation, not an engineering reference').waitFor();
    await page.screenshot({path:join(output,'render-history.png')});
  });
  await page.getByRole('button',{name:'Board',exact:true}).click();
  const controls=()=>[page.getByLabel('Selected board'),page.getByLabel('Message Codex'),page.getByRole('button',{name:'Stop agent',exact:true}),...['Allow once','Decline','Always allow'].map(name=>page.getByRole('button',{name,exact:true}))];
  await check('Selection, pending approvals, Stop and composer are reachable at six CSS widths',async()=>{
    for(const width of [1024,1440,1920,512,720,960]){await page.setViewportSize({width,height:1000});for(const control of controls())await reachable(control);await page.screenshot({path:join(output,`legacy-${width}.png`)});}
  });
  await check('Legacy permission inspection and revoke control remain present',async()=>{
    await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Permissions · 1',exact:true}).click();
    await page.getByRole('button',{name:'Revoke Fixture selection',exact:true}).click();await page.getByText('No remembered permissions. Choose Always allow on an approval to add one.',{exact:true}).waitFor();
  });
  if(headed){await page.setViewportSize({width:1200,height:1000});console.log(JSON.stringify({origin,pid:process.pid,readyForNativeZoom:true}));process.stdin.resume();for await(const chunk of process.stdin){if(!String(chunk).includes('verify-zoom'))continue;const zoom=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));assert.equal(zoom.dpr,2);for(const control of controls())await reachable(control);evidence.nativeZoom={...zoom,widthChecks:[]};
    for(const width of [512,720,960,1024,1440,1920]){await page.setViewportSize({width:width*2,height:1800});const observed=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));assert.equal(observed.dpr,2);assert.equal(observed.width,width);for(const control of controls())await reachable(control);evidence.nativeZoom.widthChecks.push(observed);await page.screenshot({path:join(output,`native-zoom-${width}.png`)});}
    await page.screenshot({path:join(output,'native-zoom.png'),fullPage:true});break;}process.stdin.pause();}
  assert.deepEqual(evidence.errors,[]);evidence.passed=true;
}catch(error){evidence.passed=false;evidence.failure=error.stack;const failedPage=browser?.contexts()[0]?.pages()[0];if(failedPage){await failedPage.screenshot({path:join(output,'failure.png')}).catch(()=>{});await writeFile(join(output,'failure.txt'),await failedPage.locator('body').innerText()).catch(()=>{});}throw error;}
finally{clearInterval(heartbeat);await browser?.close();for(const stream of streams)stream.end();server.closeAllConnections();await new Promise(r=>server.close(r));evidence.serverClosed=true;await writeFile(join(output,'evidence.json'),JSON.stringify(evidence,null,2));}
