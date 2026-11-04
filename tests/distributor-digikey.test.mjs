import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {digiKeyConfigSchema,createDigiKeyReader,readDigiKeyCredentials,requestDigiKey,normalizeDigiKeyProduct} from '../server/distributor-digikey.mjs';
import {ModulePackageStore,modulePackageRoutes} from '../server/module-packages.mjs';
import {bomWithSourcingObservation,exportBom,importBom} from '../shared/modules.mjs';
import {fixtureModule,fixtureBom} from './fixtures/module-package.mjs';
import {configuration} from '../server/config.mjs';
const creds={clientId:'synthetic-client-id',clientSecret:'synthetic-client-secret',accountId:'42'};
const reg={manufacturer:'Fixture vendor',mpn:'Synthetic module',hardwareRevision:'fixture-r1',sku:'FAKE-001',packaging:'tray',sourceUrl:'https://www.digikey.com/en/products/detail/fixture/FAKE-001/1'};
const cfg=path=>({schemaVersion:1,enabled:true,credentialFile:path,products:[reg]});
const token=Buffer.from(JSON.stringify({access_token:'synthetic-access-token',expires_in:599,token_type:'Bearer'}));
function payload(change=()=>{}){
 const p={SearchLocaleUsed:{Site:'US',Language:'en',Currency:'USD'},AccountIdUsed:42,CustomerIdUsed:9876,Product:{Manufacturer:{Name:reg.manufacturer},ManufacturerProductNumber:reg.mpn,QuantityAvailable:999999,
   ProductVariations:[{DigiKeyProductNumber:reg.sku,PackageType:{Name:'tray'},StandardPricing:[{BreakQuantity:1,UnitPrice:'NUMERIC_125'},{BreakQuantity:10,UnitPrice:'NUMERIC_090'}],MyPricing:[{BreakQuantity:1,UnitPrice:0.001}],QuantityAvailableforPackageType:5,MinimumOrderQuantity:1,MarketPlace:false}]}};
 change(p);return Buffer.from(JSON.stringify(p).replace('"NUMERIC_125"','1.25000000').replace('"NUMERIC_090"','0.9000'));
}
const item=()=>({manufacturer:reg.manufacturer,mpn:reg.mpn,quantity:12,packaging:'tray',dnp:false});
function mockTransport(inspect,{statusCode=200,contentType='application/json',body=token,encoding,location}={}){
 return (url,options,callback)=>{const req=new EventEmitter();req.end=value=>{inspect(url,options,value);queueMicrotask(()=>{const res=new PassThrough();res.statusCode=statusCode;res.headers={'content-type':contentType,...(encoding?{'content-encoding':encoding}:{}),...(location?{location}:{})};callback(res);res.end(body);});};return req;};
}
async function temp(t){const root=await mkdtemp(join(tmpdir(),'benchline-digikey-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('DigiKey fixed transport pins public DNS, scopes credentials and refuses redirects and non-JSON responses',async()=>{
 const options={credentials:creds,accessToken:'synthetic-access-token',productSku:reg.sku};let calls=0;
 for(const stage of ['token','product'])await requestDigiKey(stage,options,{resolveHost:async()=>[{address:'1.1.1.1'}],request:mockTransport((url,o,body)=>{
   calls++;assert.equal(new URL(url).hostname,'api.digikey.com');assert.equal(o.servername,'api.digikey.com');assert.equal(o.rejectUnauthorized,true);assert.equal(o.agent,false);assert.deepEqual(o.proxyEnv,{});
   o.lookup('ignored',{},(e,address,family)=>{assert.equal(e,null);assert.equal(address,'1.1.1.1');assert.equal(family,4);});
   if(stage==='token'){assert.equal(url,'https://api.digikey.com/v1/oauth2/token');assert.equal(o.method,'POST');assert.equal(new URLSearchParams(body).get('client_secret'),creds.clientSecret);assert.equal(o.headers.Authorization,undefined);}
   else{assert.equal(url,'https://api.digikey.com/products/v4/search/FAKE-001/productdetails');assert.equal(o.method,'GET');assert.equal(body,undefined);assert.equal(o.headers['X-DIGIKEY-Account-Id'],'42');assert.equal(o.headers['X-DIGIKEY-Locale-Currency'],'USD');assert.equal(o.headers.Authorization,'Bearer synthetic-access-token');assert.equal(JSON.stringify(o).includes(creds.clientSecret),false);}
 })});assert.equal(calls,2);
 for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','::1'])await assert.rejects(requestDigiKey('token',options,{resolveHost:async()=>[{address}],request:()=>{throw Error('must not call');}}),/public IPv4/);
 for(const change of [{statusCode:302,location:'https://elsewhere.invalid'},{contentType:'text/html'},{encoding:'gzip'},{body:Buffer.alloc(16385)}])await assert.rejects(requestDigiKey('token',options,{resolveHost:async()=>[{address:'1.1.1.1'}],request:mockTransport(()=>{},change)}));
 await assert.rejects(requestDigiKey('order',options),/Unsupported/);
});
test('credential loading is private, bounded, outside project roots and never exposes invalid file content',async t=>{
 const root=await temp(t),path=join(root,'credential.json');await writeFile(path,JSON.stringify(creds),{mode:0o600});assert.deepEqual(await readDigiKeyCredentials(path),creds);
 await assert.rejects(readDigiKeyCredentials(path,{prohibitedRoots:[root]}),/outside project/);
 const child=join(root,'..private');await mkdir(child);const hidden=join(child,'credential.json');await writeFile(hidden,JSON.stringify(creds),{mode:0o600});await assert.rejects(readDigiKeyCredentials(hidden,{prohibitedRoots:[root]}),/outside project/);
 const link=join(root,'link.json');await symlink(path,link);await assert.rejects(readDigiKeyCredentials(link),/unavailable or invalid/);
 await chmod(path,0o644);await assert.rejects(readDigiKeyCredentials(path),/unavailable or invalid/);await chmod(path,0o600);
 await writeFile(path,creds.clientSecret);await assert.rejects(readDigiKeyCredentials(path),e=>!e.message.includes(creds.clientSecret));
 await writeFile(path,'x'.repeat(16385));await assert.rejects(readDigiKeyCredentials(path));
 for(const value of ['relative.json','/tmp/path\nsecret'])assert.throws(()=>configuration({env:{BENCHLINE_DIGIKEY:value}}),/absolute host/);
 assert.equal(digiKeyConfigSchema.safeParse({...cfg(path),products:[reg,reg]}).success,false);
});
test('normalization preserves exact decimal tokens, package stock and standard price tier without accepting substitutes',()=>{
 const input={registration:reg,quantity:12,accountId:'42'};
 const r=normalizeDigiKeyProduct(payload(),input);assert.equal(r.offer.unitPrice,'0.9000');assert.equal(r.offer.availableQuantity,5);assert.equal(r.priceBreakQuantity,10);assert.equal(r.offer.substitute,false);
 assert.equal(normalizeDigiKeyProduct(payload(),{...input,quantity:1}).offer.unitPrice,'1.25000000');
 assert.equal(normalizeDigiKeyProduct(payload(p=>delete p.Product.ProductVariations[0].QuantityAvailableforPackageType),input).offer.availableQuantity,null);
 for(const change of [p=>p.SearchLocaleUsed.Currency='CAD',p=>p.AccountIdUsed=123,p=>p.Product.Manufacturer.Name='Other',p=>p.Product.ManufacturerProductNumber='SUBSTITUTE',
  p=>p.Product.ProductVariations[0].DigiKeyProductNumber='OTHER',p=>p.Product.ProductVariations[0].PackageType.Name='reel',p=>p.Product.ProductVariations[0].MarketPlace=true,
  p=>p.Product.ProductVariations[0].MinimumOrderQuantity=20,p=>p.Product.ProductVariations.push(p.Product.ProductVariations[0]),
  p=>p.Product.ProductVariations[0].StandardPricing[0].UnitPrice='0.123456789',p=>p.Product.ProductVariations[0].StandardPricing.push(p.Product.ProductVariations[0].StandardPricing[0])])assert.throws(()=>normalizeDigiKeyProduct(payload(change),input));
 const text=JSON.stringify(r);assert.equal(text.includes('9876'),false);assert.equal(text.includes('MyPricing'),false);
});
test('reader stays disabled without host registration, rechecks authority between stages and redacts errors',async()=>{
 let credentialReads=0,calls=0,allowed=true;const credentials=async()=>{credentialReads++;return creds;};
 const pkg=fixtureModule(),i=item();
 const disabled=createDigiKeyReader(undefined,{credentials,exchange:async()=>{calls++;}});assert.equal(disabled.supports(i,pkg),false);await assert.rejects(disabled.observe(i,pkg));assert.equal(credentialReads,0);assert.equal(calls,0);
 const reader=createDigiKeyReader(cfg('/host/credential.json'),{credentials,exchange:async stage=>{calls++;return stage==='token'?token:payload();}});
 const result=await reader.observe(i,pkg);assert.equal(result.status,'retrieved');assert.equal(result.hardwareRevisionVerified,false);assert.equal(calls,2);
 assert.equal(JSON.stringify(result).includes(creds.clientSecret),false);assert.equal(JSON.stringify(result).includes('synthetic-access-token'),false);
 const changed=structuredClone(pkg);changed.identity.hardwareRevision.value='another';await assert.rejects(reader.observe(i,changed));assert.equal(calls,2);
 const revoked=createDigiKeyReader(cfg('/host/credential.json'),{credentials,exchange:async()=>{allowed=false;return token;}});
 await assert.rejects(revoked.observe(i,pkg,{authorize:()=>{if(!allowed)throw Error('Controller revoked');}}),/revoked/);
 const bad=createDigiKeyReader(cfg('/host/credential.json'),{credentials,exchange:async()=>{throw Error(creds.clientSecret);}});
 assert.equal((await bad.observe(i,pkg)).reason,'DigiKey retrieval failed; no BOM facts were changed.');
 let signal;const slow=createDigiKeyReader(cfg('/host/credential.json'),{credentials,timeoutMs:5,exchange:async(_,options)=>{signal=options.signal;return new Promise(()=>{});}});
 assert.match((await slow.observe(i,pkg)).reason,/timed out/);assert.equal(signal.aborted,true);
});
async function setup(t,{exchange=async stage=>stage==='token'?token:payload()}={}){
 const root=await temp(t),projectId=randomUUID(),expectedHash='f'.repeat(64),pkg=fixtureModule();
 const distributor=createDigiKeyReader(cfg(join(root,'unused.json')),{credentials:async()=>creds,exchange});
 const store=new ModulePackageStore({path:join(root,'module-store.json'),projects:{open:async()=>({hash:expectedHash,root:join(root,'project')})},distributor});await store.init();
 const module=await store.importPackage({projectId,expectedHash,package:pkg}),bom=fixtureBom();Object.assign(bom.items[0],item(),{offers:[],moduleRef:{id:module.id,revision:module.revision,sha256:module.sha256}});
 const record=await store.importBom({projectId,expectedHash,bom});const input={requestId:randomUUID(),projectId,expectedHash,expectedBomRevision:record.bom.revision,expectedBomSha256:record.sha256,itemId:bom.items[0].id};
 return {root,store,record,module,input};
}
test('sourcing preserves immutable BOM/package, persists idempotent receipts and exports a separate matching proposal',async t=>{
 let calls=0;const f=await setup(t,{exchange:async stage=>{calls++;return stage==='token'?token:payload();}});
 await assert.rejects(f.store.retrieveSourcing(f.record.id,{...f.input,expectedBomSha256:'a'.repeat(64)}),/BOM changed/);assert.equal(calls,0);
 const receipt=await f.store.retrieveSourcing(f.record.id,f.input);assert.equal(receipt.observation.status,'retrieved');
 assert.deepEqual(await f.store.retrieveSourcing(f.record.id,f.input),receipt);assert.equal(calls,2);
 await assert.rejects(f.store.retrieveSourcing(f.record.id,{...f.input,itemId:randomUUID()}),/another request/);
 const listing=f.store.list(f.input.projectId);assert.deepEqual(listing.boms[0].bom,f.record.bom);assert.deepEqual(listing.packages[0].package,f.module.package);
 const proposal=bomWithSourcingObservation(f.record.bom,f.input.itemId,receipt.observation.offer);assert.equal(proposal.revision,2);assert.equal(f.record.bom.revision,1);
 assert.equal(proposal.items[0].offers[0].unitPrice,'0.9000');assert.deepEqual(importBom(exportBom(proposal)),proposal);
 assert.throws(()=>bomWithSourcingObservation(f.record.bom,f.input.itemId,{...receipt.observation.offer,packaging:'reel'}),/does not match/);
 const reopened=new ModulePackageStore({path:f.store.path,projects:f.store.projects,distributor:f.store.distributor});await reopened.init();assert.deepEqual(reopened.list(f.input.projectId),listing);
 const raw=await readFile(f.store.path,'utf8');for(const secret of [creds.clientId,creds.clientSecret,creds.accountId,'synthetic-access-token','9876'])assert.equal(raw.includes('"'+secret+'"'),false);
});
test('sourcing rejects stale module links and revoked controllers without persisting a result',async t=>{
 let finish,started;const waiting=new Promise(r=>started=r);const f=await setup(t,{exchange:async stage=>{if(stage==='token')return token;started();return new Promise(r=>finish=r);}});
 let allowed=true;const authorize=()=>{if(!allowed)throw Error('Controller revoked');};
 const work=f.store.retrieveSourcing(f.record.id,f.input,{authorize});await waiting;allowed=false;finish(payload());await assert.rejects(work,/revoked/);assert.equal(f.store.data.sourcing.length,0);
 await f.store.reviewField(f.module.id,{projectId:f.input.projectId,expectedHash:f.input.expectedHash,expectedRevision:1,expectedSha256:f.module.sha256,field:'identity.hardwareRevision',decision:'confirm',note:'Fixture revision changes the immutable record hash'});
 assert.deepEqual(f.store.list(f.input.projectId).boms[0].retrievableItemIds,[]);await assert.rejects(f.store.retrieveSourcing(f.record.id,{...f.input,requestId:randomUUID()}),/current module/);
});
test('sourcing route enforces controller ownership and rejects URL/credential overrides',async t=>{
 const f=await setup(t);const app=express();app.use(express.json());modulePackageRoutes(app,{store:f.store,views:{authorize:(_,token)=>{if(token!=='fixture-controller')throw Object.assign(Error('Observer cannot write'),{status:403});}}});app.use((e,_req,res,_next)=>res.status(e.status||400).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/api/module-library/projects/${f.input.projectId}/boms/${f.record.id}/sourcing/retrieve`,{projectId,...body}=f.input;
 const post=(value,controller)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(controller?{'X-Benchline-Controller':controller}:{})},body:JSON.stringify(value)});
 assert.equal((await post(body)).status,403);assert.equal((await post({...body,url:'https://elsewhere.invalid'},'fixture-controller')).status,400);assert.equal((await post({...body,clientSecret:'do-not-accept'},'fixture-controller')).status,400);
 assert.equal((await post(body,'fixture-controller')).status,200);assert.equal(f.store.data.sourcing.length,1);
});
