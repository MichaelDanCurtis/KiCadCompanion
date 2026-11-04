// Opt-in disposable production UI test. No real credentials or vendor requests.
// Success is seeded through the production store with an injected response while
// the server is stopped. This is offline evidence, never live API qualification.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {modulePackageSchema,bomSchema} from '../../shared/modules.mjs';
import {createDigiKeyReader} from '../../server/distributor-digikey.mjs';
import {ModulePackageStore} from '../../server/module-packages.mjs';
import {configuration} from '../../server/config.mjs';

const [flag,modulePath,bomPath,playwrightPath,executablePath,outputPath]=process.argv.slice(2);
assert.equal(flag,'--run-disposable-offline');
assert.ok([modulePath,bomPath,playwrightPath,executablePath,outputPath].every(p=>p&&resolve(p)===p));
const pkg=modulePackageSchema.parse(JSON.parse(await readFile(modulePath,'utf8')));
const bom=bomSchema.parse(JSON.parse(await readFile(bomPath,'utf8')));
bom.name='OFFLINE FIXTURE — DigiKey sourcing UI';bom.id=randomUUID();
assert.equal(bom.items.length,1);assert.equal(bom.items[0].mpn,'ESP32-S3-EYE');
const root=await mkdtemp(join(tmpdir(),'benchline-distributor-offline-'));
const workspace=join(root,'workspace');await mkdir(workspace);await mkdir(outputPath,{recursive:true});
const registration={manufacturer:'Espressif Systems',mpn:'ESP32-S3-EYE',hardwareRevision:'v2.2',sku:'1965-ESP32-S3-EYE-ND',packaging:'Bulk',sourceUrl:'https://www.digikey.com/en/products/detail/espressif-systems/ESP32-S3-EYE/17887518'};
const config={schemaVersion:1,enabled:true,credentialFile:join(root,'intentionally-missing-credential.json'),products:[registration]};
const configPath=join(root,'nonsecret-config.json');await writeFile(configPath,JSON.stringify(config));
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('BENCHLINE_')&&!key.startsWith('COMPANION_')));
const env={...clean,BENCHLINE_WORKSPACE:workspace,BENCHLINE_STATE_DIR:join(root,'state'),BENCHLINE_PORT:String(port),BENCHLINE_AUTOCONNECT:'0',CODEX_BIN:'/nonexistent/no-model',KONNECT_BIN:'/nonexistent/no-native'};
const runtime=configuration({env}).runtime,origin=`http://127.0.0.1:${port}`;
const evidence={at:new Date().toISOString(),fixtureRoot:root,liveDistributorVerified:false,realCredentialsUsed:false,modelUsed:false,nativeUsed:false,checks:[],errors:[],serverExits:[]};
let child,closed,logs='',browser,page,project;
async function start(configured){
 child=spawn(process.execPath,['server/index.mjs'],{env:{...env,...(configured?{BENCHLINE_DIGIKEY:configPath}:{})},stdio:['ignore','pipe','pipe']});closed=once(child,'close');
 child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/state')).ok)return;}catch{}if(child.exitCode!==null)throw Error(logs);await delay(100);}throw Error('Server did not start');
}
async function stop(){if(!child)return;if(child.exitCode===null)child.kill('SIGTERM');const result=await closed;evidence.serverExits.push(result);child=null;assert.equal(result[0],0);}
async function library(){return (await fetch(origin+`/api/module-library/projects/${project.manifest.id}`)).json();}
async function openLibrary(){await page.getByRole('button',{name:'Project model',exact:true}).click();await page.getByRole('combobox',{name:'Registered projects'}).selectOption(project.manifest.id);await page.getByRole('button',{name:'Modules / BOM',exact:true}).click();}
try{
 await start(true);const {chromium}=await import(pathToFileURL(join(playwrightPath,'index.mjs')));
 browser=await chromium.launch({headless:true,executablePath});evidence.browser=browser.version();evidence.node=process.version;
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.errors.push(m.text());});
 await page.goto(origin,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Project model',exact:true}).click();
 await page.getByRole('textbox',{name:'New project name'}).fill('OFFLINE distributor qualification');await page.getByRole('button',{name:'Create empty project',exact:true}).click();
 await page.getByRole('heading',{name:'OFFLINE distributor qualification · revision 1',exact:true}).waitFor();
 const projects=await (await fetch(origin+'/api/product-projects')).json();project=await (await fetch(origin+`/api/product-projects/${projects.projects[0].id}`)).json();
 await page.getByRole('button',{name:'Modules / BOM',exact:true}).click();const panel=page.getByRole('region',{name:'Module packages and BOM'});
 await panel.getByLabel('Import module package JSON',{exact:true}).setInputFiles(modulePath);await panel.locator('[data-record-id]').waitFor();
 const record=(await library()).packages[0];assert.equal(record.package.identity.hardwareRevision.value,'v2.2');
 bom.items[0].moduleRef={id:record.id,revision:record.revision,sha256:record.sha256};const bomFile=join(root,'offline-bom.json');await writeFile(bomFile,JSON.stringify(bom));
 await panel.getByLabel('Import BOM JSON',{exact:true}).setInputFiles(bomFile);await panel.locator('[data-bom-id]').waitFor();
 const original=(await library()).boms[0];assert.equal(original.sourcing.length,0);
 await panel.getByRole('button',{name:'Check DigiKey sourcing: DEV1',exact:true}).click();
 await panel.getByText('Dedicated DigiKey credentials are unavailable or invalid. Configure a private host file outside project and export directories.',{exact:true}).waitFor();
 const failed=(await library()).boms[0];assert.equal(failed.sourcing.length,1);assert.equal(failed.sourcing[0].observation.status,'unavailable');assert.deepEqual(failed.bom,original.bom);
 await panel.locator('[data-bom-id]').scrollIntoViewIfNeeded();await page.screenshot({path:join(outputPath,'missing-credentials.png')});
 evidence.checks.push('Actual production UI with an explicitly absent credential file records unavailable and preserves the original BOM/package.');
 await page.goto('about:blank');await stop();
 // Explicitly offline injection, only in this stopped disposable fixture.
 let exchanges=0;const distributor=createDigiKeyReader(config,{credentials:async()=>({clientId:'synthetic-client-id',clientSecret:'synthetic-client-secret',accountId:'42'}),exchange:async stage=>{
   exchanges++;if(stage==='token')return Buffer.from(JSON.stringify({access_token:'synthetic-access-token',expires_in:599,token_type:'Bearer'}));
   return Buffer.from(JSON.stringify({SearchLocaleUsed:{Site:'US',Language:'en',Currency:'USD'},AccountIdUsed:42,Product:{Manufacturer:{Name:registration.manufacturer},ManufacturerProductNumber:registration.mpn,
    ProductVariations:[{DigiKeyProductNumber:registration.sku,PackageType:{Name:registration.packaging},StandardPricing:[{BreakQuantity:1,UnitPrice:'OFFLINE_PRICE'}],QuantityAvailableforPackageType:7,MinimumOrderQuantity:1,MarketPlace:false}]}}).replace('"OFFLINE_PRICE"','1.25000000'));
 }});
 const store=new ModulePackageStore({path:join(runtime,'module-packages.json'),projects:{open:async()=>project},distributor});await store.init();
 const receipt=await store.retrieveSourcing(original.id,{requestId:randomUUID(),projectId:project.manifest.id,expectedHash:project.hash,expectedBomRevision:original.bom.revision,expectedBomSha256:original.sha256,itemId:bom.items[0].id});
 assert.equal(exchanges,2);assert.equal(receipt.observation.status,'retrieved');assert.deepEqual(store.list(project.manifest.id).packages[0].package,record.package);
 await start(false);await page.goto(origin,{waitUntil:'networkidle'});await openLibrary();
 await panel.getByText('DigiKey API access is not configured. Public-page observations do not qualify live pricing.',{exact:true}).waitFor();
 assert.equal(await panel.getByRole('button',{name:'Check DigiKey sourcing: DEV1',exact:true}).isDisabled(),true);
 const article=panel.locator(`[data-bom-id="${original.id}"]`);await article.getByText(/1\.25000000 USD per unit/).waitFor();
 await article.scrollIntoViewIfNeeded();await page.screenshot({path:join(outputPath,'offline-observation.png')});
 const downloading=page.waitForEvent('download');await article.getByRole('button',{name:'Export BOM proposal with this observation',exact:true}).click();
 const exportPath=join(outputPath,'offline-bom-proposal.json');await (await downloading).saveAs(exportPath);
 const proposal=bomSchema.parse(JSON.parse(await readFile(exportPath,'utf8')));assert.equal(proposal.revision,2);assert.deepEqual(proposal.items[0].offers,[receipt.observation.offer]);
 assert.deepEqual((await library()).boms[0].bom,original.bom);
 await panel.getByLabel('Import BOM JSON',{exact:true}).setInputFiles(exportPath);await panel.locator('[data-bom-id]').nth(1).waitFor();
 assert.deepEqual((await library()).boms[1].bom,proposal);assert.deepEqual((await library()).boms[0].bom,original.bom);
 await page.reload({waitUntil:'networkidle'});await openLibrary();await panel.locator('[data-bom-id]').nth(1).waitFor();
 const restored=await library();assert.equal(restored.boms[0].sourcing.length,2);assert.deepEqual(restored.boms[1].bom,proposal);assert.equal(restored.packages[0].readiness.ready,false);
 evidence.checks.push('Offline injected normalized observation survives full server restart; default configuration disables new reads. Production UI exports and separately reimports a revision-2 proposal with exact decimal, stock, timestamp, provenance and module link while revision 1 remains unchanged.');
 const raw=await readFile(join(runtime,'module-packages.json'),'utf8');for(const marker of ['synthetic-client-id','synthetic-client-secret','synthetic-access-token','AccountIdUsed','CustomerIdUsed'])assert.equal(raw.includes(marker),false);
 assert.equal((await (await fetch(origin+'/api/provider/product')).json()).phase,'disconnected');assert.deepEqual(evidence.errors,[]);
 evidence.result='passed';console.log('Offline DigiKey browser qualification passed. Live API access remains unverified.');
}catch(e){evidence.result='failed';evidence.failure=e.stack;process.exitCode=1;console.error(e.stack);await page?.screenshot({path:join(outputPath,'failure.png')}).catch(()=>{});}
finally{await browser?.close();await stop();await writeFile(join(outputPath,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');await writeFile(join(outputPath,'server.log'),logs);}
