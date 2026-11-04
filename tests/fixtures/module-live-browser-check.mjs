// Opt-in real public-source qualification in an isolated production workspace.
// Only supplied exact source registrations can be read; no model/native runtime.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {modulePackageSchema,bomSchema,moduleImportMaxBytes} from '../../shared/modules.mjs';
import {moduleSourceConfigSchema} from '../../server/module-sources.mjs';

const [flag,modulePath,bomPath,configPath,playwrightPath,executablePath,outputPath]=process.argv.slice(2);
assert.equal(flag,'--run-disposable-live-public');
assert.ok([modulePath,bomPath,configPath,playwrightPath,executablePath,outputPath].every(p=>p&&resolve(p)===p));
const pkg=modulePackageSchema.parse(JSON.parse(await readFile(modulePath,'utf8')));
const inputBom=bomSchema.parse(JSON.parse(await readFile(bomPath,'utf8')));
const config=moduleSourceConfigSchema.parse(JSON.parse(await readFile(configPath,'utf8')));
assert.ok(config.sources.length>0);
for(const s of config.sources){assert.equal(s.manufacturer,pkg.identity.vendor.value);assert.equal(s.model,pkg.identity.model.value);assert.equal(s.hardwareRevision,pkg.identity.hardwareRevision.value);assert.ok(pkg.sources.some(p=>p.url===s.url));}
const {chromium}=await import(pathToFileURL(join(playwrightPath,'index.mjs')));
const root=await mkdtemp(join(tmpdir(),'benchline-module-live-'));await mkdir(outputPath,{recursive:true});
const workspace=join(root,'workspace');await mkdir(workspace);
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('BENCHLINE_')&&!key.startsWith('COMPANION_')));
const child=spawn(process.execPath,['server/index.mjs'],{env:{...clean,BENCHLINE_WORKSPACE:workspace,BENCHLINE_STATE_DIR:join(root,'state'),BENCHLINE_PORT:String(port),BENCHLINE_AUTOCONNECT:'0',BENCHLINE_MODULE_SOURCES:configPath,CODEX_BIN:'/nonexistent/no-model',KONNECT_BIN:'/nonexistent/no-native'},stdio:['ignore','pipe','pipe']});
const closed=once(child,'close');let logs='';child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
const origin=`http://127.0.0.1:${port}`;let browser,page,project;
const evidence={at:new Date().toISOString(),fixtureRoot:root,modelUsed:false,nativeUsed:false,checks:[],errors:[],sourceResults:[],physicalUnitVerified:false};
async function library(){return (await fetch(origin+`/api/module-library/projects/${project.manifest.id}`)).json();}
async function openLibrary(){await page.getByRole('button',{name:'Project model',exact:true}).click();await page.getByRole('combobox',{name:'Registered projects'}).selectOption(project.manifest.id);await page.getByRole('button',{name:'Modules / BOM',exact:true}).click();}
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/state')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(logs);await delay(100);}assert.ok(ready,logs);
 browser=await chromium.launch({headless:true,executablePath});evidence.browser=browser.version();evidence.node=process.version;
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.errors.push(m.text());});
 await page.goto(origin,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Project model',exact:true}).click();
 await page.getByRole('textbox',{name:'New project name'}).fill('ESP32-S3-EYE v2.2 source qualification');await page.getByRole('button',{name:'Create empty project',exact:true}).click();
 await page.getByRole('heading',{name:'ESP32-S3-EYE v2.2 source qualification · revision 1',exact:true}).waitFor();
 const projects=await (await fetch(origin+'/api/product-projects')).json();project=await (await fetch(origin+`/api/product-projects/${projects.projects[0].id}`)).json();
 await page.getByRole('button',{name:'Modules / BOM',exact:true}).click();
 const panel=page.getByRole('region',{name:'Module packages and BOM'});
 await panel.getByLabel('Import module package JSON',{exact:true}).setInputFiles(modulePath);
 await panel.getByRole('heading',{name:'Espressif Systems · ESP32-S3-EYE',exact:true}).waitFor();
 let record=(await library()).packages[0];assert.equal(record.package.identity.hardwareRevision.value,'v2.2');assert.equal(record.package.identity.hardwareRevision.status,'proposed');assert.equal(record.readiness.ready,false);assert.equal(record.retrievals.length,0);
 evidence.checks.push('Real selected package imported as a proposal with unknown electrical and assembly limits blocking design; no automatic source retrieval.');
 await panel.getByText(/^Review facts \(/).click();await panel.getByRole('button',{name:'Review Hardware revision',exact:true}).click();
 await panel.getByRole('textbox',{name:'Review note for Hardware revision',exact:true}).fill('Pilot selection explicitly supplied by user: ESP32-S3-EYE v2.2. Main schematic title block reviewed as Rev 2.2. No physical-unit revision is asserted.');
 await panel.getByRole('button',{name:'Confirm this fact from its source',exact:true}).click();await panel.getByText('Hardware revision: v2.2 · Review revision 2',{exact:true}).waitFor();
 record=(await library()).packages[0];assert.equal(record.package.identity.hardwareRevision.status,'user-confirmed');assert.equal(record.history[0].package.identity.hardwareRevision.status,'proposed');
 await panel.getByText(/^Review facts \(/).click();await panel.getByRole('heading',{name:'Espressif Systems · ESP32-S3-EYE',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(outputPath,'selected-package.png')});
 await panel.getByText('Source and asset references',{exact:true}).click();
 for(const source of pkg.sources){
  if(!config.sources.some(c=>c.url===source.url))continue;
  await panel.getByRole('button',{name:`Check source: ${source.title}`,exact:true}).click();
  const count=evidence.sourceResults.length+1;await panel.getByText(`Source check history (${count})`,{exact:true}).waitFor({timeout:20000});
  const current=(await library()).packages[0];assert.deepEqual(current.package,record.package);assert.equal(current.sha256,record.sha256);assert.equal(current.revision,2);
  const receipt=current.retrievals.at(-1);evidence.sourceResults.push(receipt);
  console.log(source.title+': '+receipt.observation.status);
 }
 const manufacturer=config.sources.filter(c=>c.kind==='manufacturer');
 assert.ok(evidence.sourceResults.filter(r=>manufacturer.some(s=>s.url===r.sourceUrl)&&r.observation.status==='retrieved').length>=2,'At least guide and schematic must be genuinely retrieved.');
 for(const r of evidence.sourceResults.filter(r=>r.observation.status==='retrieved')){assert.equal(r.observation.sha256,r.priorSourceHash,'Source changed since preparation; review separately.');}
 evidence.checks.push('Explicit production UI source checks retained real transport receipts without changing confirmed revision, facts or package hash.');
 await panel.getByText('Source and asset references',{exact:true}).click();await panel.getByText(`Source check history (${evidence.sourceResults.length})`,{exact:true}).click();
 await panel.getByText('Checks preserve source observations separately. Engineering facts and their confirmations remain unchanged.',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(outputPath,'source-history.png')});
 const unavailable=panel.getByText('Source returned an unavailable HTTP status; redirects are not followed.',{exact:true});if(await unavailable.count()){await unavailable.scrollIntoViewIfNeeded();await page.screenshot({path:join(outputPath,'distributor-unavailable.png')});}
 const bom=structuredClone(inputBom);bom.items[0].moduleRef={id:record.id,revision:record.revision,sha256:record.sha256};const linked=join(root,'pilot-bom.json');await writeFile(linked,JSON.stringify(bom));
 await panel.getByLabel('Import BOM JSON',{exact:true}).setInputFiles(linked);await panel.getByRole('heading',{name:bom.name+' · revision 1',exact:true}).waitFor();
 const savedBom=(await library()).boms[0];assert.deepEqual(savedBom.unresolvedModuleReferences,[]);assert.equal(savedBom.bom.items[0].offers.length,0);
 const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Export BOM JSON',exact:true}).click();await (await download).saveAs(join(outputPath,'bom-round-trip.json'));assert.deepEqual(JSON.parse(await readFile(join(outputPath,'bom-round-trip.json'),'utf8')),bom);
 const moduleDownload=page.waitForEvent('download');await panel.getByRole('button',{name:'Export module package JSON',exact:true}).click();await (await moduleDownload).saveAs(join(outputPath,'module-round-trip.json'));assert.deepEqual(JSON.parse(await readFile(join(outputPath,'module-round-trip.json'),'utf8')),record.package);
 evidence.checks.push('Real pilot BOM and reviewed package export round-trip exactly; local revision/hash link resolves; no fabricated price or stock offer.');
 await page.reload({waitUntil:'networkidle'});await openLibrary();await panel.getByText(`Source check history (${evidence.sourceResults.length})`,{exact:true}).waitFor();
 const restored=(await library()).packages[0];assert.deepEqual(restored.retrievals,evidence.sourceResults);assert.deepEqual(restored.package,record.package);assert.equal(restored.readiness.ready,false);assert.ok(restored.readiness.blockers.some(b=>b.includes('depthMM: unknown')));
 evidence.checks.push('Reload retains package, review history, real source receipts and assembly/electrical blockers.');
 // Check the exported real package, including larger engineering inventories.
 const exportedPath=join(outputPath,'module-round-trip.json');
 await panel.getByLabel('Import module package JSON',{exact:true}).setInputFiles(exportedPath);
 await panel.locator('[data-record-id]').nth(1).waitFor();
 const reimported=(await library()).packages[1];assert.equal(reimported.package.identity.hardwareRevision.status,'proposed');
 assert.deepEqual(reimported.package.pins,record.package.pins);assert.deepEqual(reimported.package.sources,record.package.sources);
 const oversizedPath=join(root,'oversized.json');await writeFile(oversizedPath,' '.repeat(moduleImportMaxBytes+1));
 await panel.getByLabel('Import module package JSON',{exact:true}).setInputFiles(oversizedPath);
 await panel.getByRole('alert').filter({hasText:'This preview accepts JSON files up to 512 KiB.'}).waitFor();
 assert.equal((await library()).packages.length,2);
 evidence.checks.push('The real exported package re-imports with all pins/sources preserved and approvals demoted; files above 512 KiB are refused without creating a record.');
 // A deliberately conflicting source variant tests the source-level gate even
 // when its fact still claims to be merely proposed. Not another real revision.
 const conflict=structuredClone(pkg),ref=conflict.identity.hardwareRevision.sources[0];
 conflict.sources.find(s=>s.id===ref.sourceId).revisionStatus='conflicting';
 conflict.identity.hardwareRevision.status='proposed';
 const conflictPath=join(root,'negative-source-conflict.json');await writeFile(conflictPath,JSON.stringify(conflict));
 await panel.getByLabel('Import module package JSON',{exact:true}).setInputFiles(conflictPath);
 await panel.locator('[data-record-id]').nth(2).waitFor();
 const rejected=(await library()).packages[2],article=panel.locator(`[data-record-id="${rejected.id}"]`);
 await article.getByText(/^Review facts \(/).click();await article.getByRole('button',{name:'Review Hardware revision',exact:true}).click();
 await article.getByRole('textbox',{name:'Review note for Hardware revision',exact:true}).fill('Negative fixture: source revision conflict must prevent confirmation.');
 assert.equal(await article.getByRole('button',{name:'Confirm this fact from its source',exact:true}).isDisabled(),true);
 await article.getByText('A source revision is conflicting or unreviewed. This fact needs a separate sourced proposal before confirmation.',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:join(outputPath,'source-conflict-blocked.png')});
 const token=await page.evaluate(id=>sessionStorage.getItem(`benchline.window-controller.v1:${id}`),project.manifest.id);
 const denied=await page.request.post(origin+`/api/module-library/projects/${project.manifest.id}/packages/${rejected.id}/review`,{headers:{'X-Benchline-Controller':token},data:{expectedHash:project.hash,expectedRevision:rejected.revision,expectedSha256:rejected.sha256,field:'identity.hardwareRevision',decision:'confirm',note:'Negative fixture source conflict review must be refused'}});
 assert.equal(denied.status(),409);assert.match((await denied.json()).error,/Source revision/);
 assert.deepEqual((await library()).packages[0].package,record.package);
 evidence.checks.push('A separately imported negative source-conflict fixture cannot be confirmed through UI or direct HTTP; the real reviewed package remains unchanged.');
 assert.equal((await (await fetch(origin+'/api/provider/product')).json()).phase,'disconnected');assert.deepEqual(evidence.errors,[]);
 evidence.manufacturerLiveVerified=true;evidence.distributorLiveVerified=evidence.sourceResults.some(r=>config.sources.some(s=>s.kind==='distributor'&&s.url===r.sourceUrl)&&r.observation.status==='retrieved');
 evidence.projectId=project.manifest.id;evidence.packageRecordId=record.id;evidence.packageSha256=record.sha256;evidence.result='passed';console.log('Production package/source/BOM checks passed; distributor live verified: '+evidence.distributorLiveVerified);
}catch(e){evidence.result='failed';evidence.failure=e.stack;process.exitCode=1;console.error(e.stack);if(page)await page.screenshot({path:join(outputPath,'failure.png')}).catch(()=>{});}
finally{await browser?.close();if(child.exitCode===null)child.kill('SIGTERM');evidence.serverExit=await closed;await writeFile(join(outputPath,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');await writeFile(join(outputPath,'server.log'),logs);}
