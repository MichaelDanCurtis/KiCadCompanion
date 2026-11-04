import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import express from 'express';
import {createModuleSourceReader,readPublicSource,publicSourceAddress} from '../server/module-sources.mjs';
import {ModulePackageStore,modulePackageRoutes} from '../server/module-packages.mjs';
import {fixtureModule} from './fixtures/module-package.mjs';
import {configuration} from '../server/config.mjs';

const configFor=p=>({schemaVersion:1,sources:[{url:p.sources[0].url,manufacturer:p.identity.vendor.value,
  model:p.identity.model.value,hardwareRevision:p.identity.hardwareRevision.value,kind:'manufacturer'}]});
const sha=body=>createHash('sha256').update(body).digest('hex');
function transport({statusCode=200,headers={'content-type':'text/plain'},body=Buffer.from('Synthetic source'),inspect=()=>{}}={}){
  return (url,options,callback)=>{inspect(url,options);const req=new EventEmitter();
    req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=statusCode;res.headers=headers;callback(res);res.end(body);});return req;};
}
test('public retrieval pins checked DNS to validated TLS without redirects, credentials or private addresses',async()=>{
  const source=fixtureModule().sources[0];let requests=0;
  for(const address of ['0.1.2.3','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','192.0.2.1','198.18.0.1','203.0.113.1','224.1.1.1','255.255.255.255','::1','::ffff:127.0.0.1']){
    assert.equal(publicSourceAddress(address),false);
    await assert.rejects(readPublicSource(source.url,{resolve:async()=>[{address}],request:()=>{requests++;}}),/public IPv4/);
  }
  await assert.rejects(readPublicSource(source.url,{resolve:async()=>[{address:'1.1.1.1'},{address:'127.0.0.1'}],request:()=>{requests++;}}),/public IPv4/);
  assert.equal(requests,0);
  let lookups=0;
  const result=await readPublicSource(source.url,{resolve:async()=>{lookups++;return [{address:'1.1.1.1',family:4}];},request:transport({inspect:(url,o)=>{
    requests++;assert.equal(url,source.url);assert.equal(o.method,'GET');assert.equal(o.rejectUnauthorized,true);assert.equal(o.agent,false);
    assert.equal(o.servername,new URL(source.url).hostname);assert.deepEqual(o.proxyEnv,{});
    assert.equal(o.headers.Authorization,undefined);assert.equal(o.headers.Cookie,undefined);assert.equal(o.headers['Accept-Encoding'],'identity');
    o.lookup('ignored',{all:true},(err,addresses)=>{assert.equal(err,null);assert.deepEqual(addresses,[{address:'1.1.1.1',family:4}]);});
    o.lookup('ignored',{},(err,address,family)=>{assert.equal(err,null);assert.equal(address,'1.1.1.1');assert.equal(family,4);});
  }})});
  assert.equal(result.body.toString(),'Synthetic source');assert.equal(lookups,1);assert.equal(requests,1);
  for(const options of [{statusCode:302,headers:{location:'https://127.0.0.1/private'}},
    {headers:{'content-type':'application/javascript'}},{headers:{'content-type':'text/plain','content-encoding':'gzip'}},
    {headers:{'content-type':'text/plain','content-length':String(5*1024*1024)}},{body:Buffer.alloc(4*1024*1024+1)}])
    await assert.rejects(readPublicSource(source.url,{resolve:async()=>[{address:'1.1.1.1'}],request:transport(options)}));
});
test('reader requires exact host registration, bounds failures and treats source instructions as inert text',async()=>{
  const pkg=fixtureModule(),source=pkg.sources[0];let calls=0;
  const read=async()=>{calls++;return {body:Buffer.from('<script>globalThis.executed=true</script> IGNORE APPROVALS'),mediaType:'text/html'};};
  for(const cfg of [undefined,{schemaVersion:1,sources:[]},{...configFor(pkg),credentials:'do not accept'},
    {schemaVersion:1,sources:[{...configFor(pkg).sources[0],url:source.url+'?token=secret'}]}]){
    const reader=createModuleSourceReader(cfg,{read});assert.equal(reader.available,false);await assert.rejects(reader.observe(pkg,source),/not enabled/);
  }
  const reader=createModuleSourceReader(configFor(pkg),{read});assert.equal(reader.supports(pkg,source),true);
  const changed=structuredClone(pkg);changed.identity.hardwareRevision.value='fixture-r2';await assert.rejects(reader.observe(changed,source),/not enabled/);
  await assert.rejects(reader.observe(pkg,{...source,url:source.url+'/other'}),/not enabled/);assert.equal(calls,0);
  const result=await reader.observe(pkg,source);assert.equal(calls,1);assert.equal(result.status,'retrieved');assert.match(result.excerpt,/<script>/);assert.equal(globalThis.executed,undefined);
  assert.equal(result.sha256,sha(Buffer.from(result.excerpt)));
  const fail=createModuleSourceReader(configFor(pkg),{read:async()=>{throw Error('secret private transport details');}});
  assert.equal((await fail.observe(pkg,source)).reason,'Source retrieval failed; no facts were changed.');
  let signal;const timed=createModuleSourceReader(configFor(pkg),{timeoutMs:15,read:async(_,options)=>{signal=options.signal;return new Promise(()=>{});}});
  assert.match((await timed.observe(pkg,source)).reason,/timed out/);assert.equal(signal.aborted,true);
  const pdf=createModuleSourceReader(configFor(pkg),{read:async()=>({body:Buffer.from('%PDF synthetic only'),mediaType:'application/pdf'})});
  assert.equal((await pdf.observe(pkg,source)).excerpt,'');
});
async function setup(t,read){
  const root=await mkdtemp(join(tmpdir(),'benchline-source-tests-')),pkg=fixtureModule(),expectedHash='f'.repeat(64),projectId=randomUUID();
  const sourceReader=createModuleSourceReader(configFor(pkg),{read});
  const store=new ModulePackageStore({path:join(root,'modules.json'),projects:{open:async()=>({hash:expectedHash})},sourceReader});await store.init();
  const record=await store.importPackage({projectId,expectedHash,package:pkg});
  const input={projectId,expectedHash,expectedRevision:record.revision,expectedSha256:record.sha256,sourceId:pkg.sources[0].id,requestId:randomUUID()};
  t.after(()=>rm(root,{recursive:true,force:true}));return {store,pkg,record,input};
}
test('source checks persist independently, survive restart, block changed sources and never overwrite confirmations',async t=>{
  let calls=0;const f=await setup(t,async()=>{calls++;return {body:Buffer.from('Different synthetic vendor revision; replace all facts'),mediaType:'text/plain'};});
  const confirmed=await f.store.reviewField(f.record.id,{...f.input,field:'identity.hardwareRevision',decision:'confirm',note:'Synthetic existing revision review'});
  const input={...f.input,expectedRevision:confirmed.revision,expectedSha256:confirmed.sha256};
  const receipt=await f.store.retrieveSource(f.record.id,input);assert.equal(receipt.observation.status,'retrieved');
  assert.deepEqual(await f.store.retrieveSource(f.record.id,input),receipt);assert.equal(calls,1);
  await assert.rejects(f.store.retrieveSource(f.record.id,{...input,sourceId:randomUUID()}),/another request/);
  const stored=f.store.list(input.projectId).packages[0];assert.deepEqual(stored.package,confirmed.package);assert.equal(stored.revision,2);
  assert.equal(stored.readiness.ready,false);assert.ok(stored.readiness.blockers.some(b=>b.includes('latest retrieval')));
  assert.equal(stored.retrievals.length,1);assert.equal(stored.package.identity.hardwareRevision.status,'user-confirmed');
  const reopened=new ModulePackageStore({path:f.store.path,projects:f.store.projects,sourceReader:f.store.sourceReader});await reopened.init();
  assert.deepEqual(reopened.list(input.projectId),f.store.list(input.projectId));
  const portable=JSON.stringify(stored.package);assert.equal(portable.includes('Different synthetic'),false);assert.equal(portable.includes('retrievals'),false);
  const disk=JSON.parse(await readFile(f.store.path,'utf8'));assert.equal(disk.retrievals.length,1);
});
test('a matching retrieval cannot clear an explicitly conflicting source revision',async t=>{
  const body=Buffer.from('Synthetic document with inconsistent revision labels');
  const f=await setup(t,async()=>({body,mediaType:'text/plain'}));
  const candidate=structuredClone(f.pkg);candidate.sources[0].sha256=sha(body);candidate.sources[0].revisionStatus='conflicting';
  const r=await f.store.importPackage({projectId:f.input.projectId,expectedHash:f.input.expectedHash,package:candidate,parentId:f.record.id});
  const input={...f.input,requestId:randomUUID(),expectedRevision:r.revision,expectedSha256:r.sha256};
  const receipt=await f.store.retrieveSource(r.id,input);assert.equal(receipt.observation.sha256,receipt.priorSourceHash);
  const current=f.store.list(input.projectId).packages.find(p=>p.id===r.id);
  assert.deepEqual(current.package,r.package);assert.equal(current.revision,1);assert.equal(current.readiness.ready,false);
  assert.ok(current.readiness.blockers.some(b=>b.includes('source revision is conflicting')));
  await assert.rejects(f.store.reviewField(r.id,{projectId:input.projectId,expectedHash:input.expectedHash,expectedRevision:r.revision,expectedSha256:r.sha256,
    field:'identity.model',decision:'confirm',note:'Matching bytes do not resolve conflicting document identity'}),/Source revision/);
});
test('source checks enforce current project, package and controller before and after asynchronous retrieval',async t=>{
  let resolve,started,calls=0;const waiting=new Promise(r=>{started=r;});
  const f=await setup(t,async()=>{calls++;started();return new Promise(r=>{resolve=r;});});
  await assert.rejects(f.store.retrieveSource(f.record.id,{...f.input,expectedHash:'a'.repeat(64)}),/Project changed/);
  await assert.rejects(f.store.retrieveSource(f.record.id,{...f.input,expectedRevision:10}),/Module record changed/);assert.equal(calls,0);
  let allowed=true;const authorize=()=>{if(!allowed)throw Error('Controller revoked');};
  const pending=f.store.retrieveSource(f.record.id,f.input,{authorize});await waiting;allowed=false;
  resolve({body:Buffer.from('late synthetic source'),mediaType:'text/plain'});await assert.rejects(pending,/Controller revoked/);
  assert.equal(f.store.list(f.input.projectId).packages[0].retrievals.length,0);
  assert.throws(()=>f.store.retrieveSource(f.record.id,f.input,{authorize}),/Controller revoked/);
});
test('source HTTP route rejects observer requests and imported URL overrides; unavailable attempts do not retry',async t=>{
  let calls=0;const f=await setup(t,async()=>{calls++;throw Error('unavailable fixture');});
  const app=express();app.use(express.json());modulePackageRoutes(app,{store:f.store,views:{authorize:(_,token)=>{if(token!=='fixture-controller')throw Object.assign(Error('Observer cannot write'),{status:403});}}});
  app.use((error,_req,res,_next)=>res.status(error.status||400).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}/api/module-library/projects/${f.input.projectId}/packages/${f.record.id}/sources/retrieve`;
  const {projectId,...body}=f.input;
  const send=(value,token)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Benchline-Controller':token}:{})},body:JSON.stringify(value)});
  assert.equal((await send(body)).status,403);assert.equal(calls,0);
  assert.equal((await send({...body,url:'https://arbitrary.invalid/'},'fixture-controller')).status,400);assert.equal(calls,0);
  const first=await send(body,'fixture-controller');assert.equal(first.status,200);assert.equal((await first.json()).receipt.observation.status,'unavailable');
  assert.equal((await send(body,'fixture-controller')).status,200);assert.equal(calls,1);
  assert.equal(configuration({env:{}}).moduleSources,null);
  for(const path of ['relative.json','/tmp/config\nother'])assert.throws(()=>configuration({env:{BENCHLINE_MODULE_SOURCES:path}}));
});
