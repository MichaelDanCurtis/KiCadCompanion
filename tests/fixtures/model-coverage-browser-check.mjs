// Opt-in production browser check using an existing actual render and isolated local state.
// No CAD edits, model calls, credentials, or native-editor connection.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {configuration} from '../../server/config.mjs';
import {claimState} from '../../server/instance.mjs';
import {modelCoverage} from '../../shared/model-coverage.mjs';
const [flag,jobDir,playwrightPath,executablePath,output]=process.argv.slice(2);
assert.equal(flag,'--run-disposable');assert.ok([jobDir,playwrightPath,executablePath,output].every(p=>p&&resolve(p)===p));
const current=JSON.parse(await readFile(join(jobDir,'manifest.json')));assert.equal(current.status,'completed');assert.equal(current.modelInputsVerified,true);
const coverage=modelCoverage(current.models);assert.ok(coverage.omitted.length>0&&coverage.partial.length>0);
const root=await mkdtemp(join(tmpdir(),'benchline-model-coverage-'));await mkdir(output,{recursive:true});
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('BENCHLINE_')&&!key.startsWith('COMPANION_')));
const env={...clean,BENCHLINE_WORKSPACE:dirname(current.board),BENCHLINE_STATE_DIR:join(root,'state'),BENCHLINE_PORT:String(port),BENCHLINE_AUTOCONNECT:'0',CODEX_BIN:'/nonexistent/no-model',KONNECT_BIN:'/nonexistent/no-native',BENCHLINE_PYTHON:'/nonexistent/no-native-observer'};
const config=configuration({env});await claimState(config,process.cwd());const runtime=config.runtime;
await writeFile(join(runtime,'session.json'),JSON.stringify({board:current.board,messages:[],surfaces:{}}));
// Historical-format presentation fixture, derived from the real render metadata.
const old={...structuredClone(current),id:randomUUID(),createdAt:'2026-01-01T00:00:00Z'};delete old.models.schemaVersion;delete old.modelInputsVerified;
for(const c of old.models.components)delete c.dnp;
for(const job of [current,old]){
 const dest=join(runtime,'renders',job.id);await mkdir(dest,{recursive:true});
 await writeFile(join(dest,'manifest.json'),JSON.stringify(job));await copyFile(join(jobDir,'actual.png'),join(dest,'actual.png'));
}
const child=spawn(process.execPath,['server/index.mjs'],{env,stdio:['ignore','pipe','pipe']});const closed=once(child,'close');let logs='',browser;
child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const evidence={at:new Date().toISOString(),root,actualRenderId:current.id,legacyFormatIsPresentationFixture:true,checks:[],errors:[]};
try{
 const origin=`http://127.0.0.1:${port}`;let ready=false;
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/state')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(logs);await delay(100);}
 assert.ok(ready,logs);
 const {chromium}=await import(pathToFileURL(join(playwrightPath,'index.mjs')));browser=await chromium.launch({headless:true,executablePath});evidence.browser=browser.version();
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>evidence.errors.push(e.message));
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Electronics',exact:true}).click();await page.getByRole('button',{name:'Render',exact:true}).click();
 const panel=page.locator('.render-evidence');await panel.waitFor();
 assert.match(await panel.innerText(),new RegExp(`${coverage.available.length} of ${coverage.populated.length} populated footprints`));
 assert.match(await panel.innerText(),/Do not populate — omitted from the render:/);
 for(const ref of coverage.omitted.map(c=>c.reference))assert.ok((await panel.innerText()).includes(ref));
 assert.match(await panel.innerText(),/Additional visible model files are missing for SW1, SW2/);
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'coverage.png'),fullPage:true});
 evidence.checks.push('Real render coverage excludes four DNP parts and names partial model lists');
 await page.getByRole('combobox',{name:'Render history'}).selectOption(old.id);
 assert.match(await panel.innerText(),/older snapshot does not record population flags/);
 assert.doesNotMatch(await panel.innerText(),/populated footprints have/);
 evidence.checks.push('Historical format asks for a new render without assuming population');
 await page.screenshot({path:join(output,'historical.png'),fullPage:true});assert.deepEqual(evidence.errors,[]);
 evidence.passed=true;
} catch(error){evidence.error=error.message;process.exitCode=1;}
finally{
 await browser?.close();if(child.exitCode===null)child.kill('SIGTERM');evidence.serverExit=await closed;
 await writeFile(join(output,'server.log'),logs);await writeFile(join(output,'receipt.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
