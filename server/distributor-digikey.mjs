import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {publicSourceAddress} from './module-sources.mjs';
import {bomOfferSchema} from '../shared/modules.mjs';

const text=z.string().trim().min(1).max(240),sku=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9+._()-]{0,119}$/);
const absolute=z.string().min(1).max(2048).refine(p=>isAbsolute(p)&&!/[\0\r\n]/.test(p));
export const digiKeyConfigSchema=z.object({schemaVersion:z.literal(1),enabled:z.literal(true),credentialFile:absolute,
  products:z.array(z.object({manufacturer:text,mpn:text,hardwareRevision:text,sku,packaging:text,
    sourceUrl:z.string().url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.digikey.com'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash;}),
  }).strict()).min(1).max(20)}).strict().superRefine((c,ctx)=>{
  const keys=c.products.map(p=>JSON.stringify([p.manufacturer,p.mpn,p.hardwareRevision,p.packaging]));
  if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Ambiguous product registration'});
});
const credentialsSchema=z.object({clientId:z.string().min(8).max(512).regex(/^[\x21-\x7e]+$/),
  clientSecret:z.string().min(8).max(2048).regex(/^[\x21-\x7e]+$/),accountId:z.string().regex(/^\d{1,15}$/)}).strict();
const fail=reason=>Object.assign(Error(reason),{distributorReason:reason});
const inside=(root,path)=>{const r=relative(root,path);return r===''||(r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\')&&!isAbsolute(r));};
export async function readDigiKeyCredentials(path,{prohibitedRoots=[]}={}){
  let file;
  try{
    absolute.parse(path);const target=await realpath(path);
    const roots=await Promise.all(prohibitedRoots.filter(Boolean).map(async p=>{try{return await realpath(p);}catch{return resolve(p);}}));
    const entry=await lstat(path);
    if(roots.some(root=>inside(root,target))||!entry.isFile()||entry.isSymbolicLink())throw Error('Unapproved location');
    file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await file.stat();
    if(!stat.isFile()||stat.size>16384||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw Error('Private owned file required');
    const raw=await file.readFile('utf8'),after=await file.stat();
    if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||await realpath(path)!==target)throw Error('Changed credential file');
    return credentialsSchema.parse(JSON.parse(raw));
  }catch{throw fail('Dedicated DigiKey credentials are unavailable or invalid. Configure a private host file outside project and export directories.');}
  finally{await file?.close();}
}

// This transport has exactly two destinations on one hostname. It cannot call
// ordering, carts, arbitrary URLs, redirects or user-provided request headers.
export async function requestDigiKey(stage,{credentials,accessToken,productSku,signal},{resolveHost=lookup,request=httpsRequest}={}){
  if(!['token','product'].includes(stage))throw fail('Unsupported DigiKey operation.');
  credentialsSchema.parse(credentials);if(stage==='product'){sku.parse(productSku);z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/).parse(accessToken);}
  signal?.throwIfAborted();const host='api.digikey.com',addresses=await resolveHost(host,{family:4,all:true});signal?.throwIfAborted();
  if(!addresses.length||addresses.some(a=>!publicSourceAddress(a.address)))throw fail('DigiKey DNS did not resolve exclusively to public IPv4 addresses.');
  const body=stage==='token'?new URLSearchParams({client_id:credentials.clientId,client_secret:credentials.clientSecret,grant_type:'client_credentials'}).toString():null;
  const url=stage==='token'?`https://${host}/v1/oauth2/token`:`https://${host}/products/v4/search/${encodeURIComponent(productSku)}/productdetails`;
  const headers={Accept:'application/json','Accept-Encoding':'identity','User-Agent':'Benchline-source-review/1',...(stage==='token'?{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}:{
    Authorization:`Bearer ${accessToken}`,'X-DIGIKEY-Client-Id':credentials.clientId,'X-DIGIKEY-Account-Id':credentials.accountId,
    'X-DIGIKEY-Locale-Site':'US','X-DIGIKEY-Locale-Language':'en','X-DIGIKEY-Locale-Currency':'USD'})};
  const maxBytes=stage==='token'?16384:1024*1024;
  return new Promise((resolveResult,reject)=>{
    const req=request(url,{method:stage==='token'?'POST':'GET',headers,signal,agent:false,proxyEnv:{},family:4,autoSelectFamily:false,servername:host,rejectUnauthorized:true,maxHeaderSize:16384,
      lookup:(_host,options,done)=>options.all?done(null,[{address:addresses[0].address,family:4}]):done(null,addresses[0].address,4)},res=>{
      const stop=reason=>{res.destroy();reject(fail(reason));};
      if(res.statusCode!==200)return stop('DigiKey returned an unavailable HTTP status; no redirect or retry was attempted.');
      if(String(res.headers['content-type']||'').split(';')[0].trim()!=='application/json')return stop('DigiKey response is not supported JSON.');
      if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity')return stop('Compressed DigiKey responses are unsupported.');
      if(res.headers['content-length']&&(!/^\d+$/.test(res.headers['content-length'])||Number(res.headers['content-length'])>maxBytes))return stop('DigiKey response exceeds the size limit.');
      let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)return stop('DigiKey response exceeds the size limit.');chunks.push(chunk);});
      res.on('error',reject);res.on('aborted',()=>reject(fail('DigiKey response was interrupted.')));res.on('end',()=>resolveResult(Buffer.concat(chunks)));
    });req.on('error',reject);req.end(body??undefined);
  });
}
const integer=z.number().int().nonnegative().safe();
const price=z.object({BreakQuantity:integer.refine(n=>n>0),UnitPrice:z.string().regex(/^\d+(?:\.\d{1,8})?$/).max(32)});
const productResponse=z.object({SearchLocaleUsed:z.object({Site:z.literal('US'),Language:z.literal('en'),Currency:z.literal('USD')}),AccountIdUsed:integer,
  Product:z.object({Manufacturer:z.object({Name:text}),ManufacturerProductNumber:text,
    ProductVariations:z.array(z.object({DigiKeyProductNumber:sku,PackageType:z.object({Name:text}),StandardPricing:z.array(price).max(100),
      QuantityAvailableforPackageType:integer.nullish(),MinimumOrderQuantity:integer.refine(n=>n>0),MarketPlace:z.boolean()})).max(100)})});
export function normalizeDigiKeyProduct(body,{registration,quantity,accountId,observedAt=new Date().toISOString()}){
  if(!Buffer.isBuffer(body)||body.length>1024*1024)throw fail('DigiKey response exceeds the size limit.');
  // Node >=22.13 retains the numeric source token; never round provider prices
  // through a binary floating-point conversion or substitute another price tier.
  let data;try{data=productResponse.parse(JSON.parse(body.toString('utf8'),(key,value,context)=>key==='UnitPrice'&&typeof value==='number'?context?.source:value));}
  catch{throw fail('DigiKey product identity, locale or price data could not be validated.');}
  const p=data.Product;if(String(data.AccountIdUsed)!==accountId||p.Manufacturer.Name!==registration.manufacturer||p.ManufacturerProductNumber!==registration.mpn)
    throw fail('DigiKey returned a different account or manufacturer part; no substitute was accepted.');
  const matches=p.ProductVariations.filter(v=>v.DigiKeyProductNumber===registration.sku&&v.PackageType.Name===registration.packaging);
  if(matches.length!==1||matches[0].MarketPlace)throw fail('Exact DigiKey SKU and packaging are unavailable or ambiguous.');
  const v=matches[0];if(quantity<v.MinimumOrderQuantity)throw fail('Requested quantity is below the distributor minimum.');
  if(new Set(v.StandardPricing.map(p=>p.BreakQuantity)).size!==v.StandardPricing.length)throw fail('DigiKey price tiers are ambiguous.');
  const tier=v.StandardPricing.filter(p=>p.BreakQuantity<=quantity).sort((a,b)=>b.BreakQuantity-a.BreakQuantity)[0];
  const sourceHash=createHash('sha256').update(body).digest('hex');
  const offer=bomOfferSchema.parse({id:randomUUID(),distributor:'DigiKey',sku:registration.sku,manufacturer:registration.manufacturer,mpn:registration.mpn,packaging:registration.packaging,
    requestedQuantity:quantity,currency:'USD',unitPrice:tier?.UnitPrice??null,availableQuantity:v.QuantityAvailableforPackageType??null,observedAt,
    sourceUrl:registration.sourceUrl,sourceHash,substitute:false});
  return {offer,priceBreakQuantity:tier?.BreakQuantity??null,minimumOrderQuantity:v.MinimumOrderQuantity,sourceHash};
}
export const distributorObservationSchema=z.object({status:z.enum(['retrieved','unavailable']),observedAt:z.string().datetime(),reason:z.string().max(300),
  offer:bomOfferSchema.nullable(),priceBreakQuantity:integer.nullable(),minimumOrderQuantity:integer.nullable(),sourceHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),hardwareRevisionVerified:z.literal(false)}).strict();
export function createDigiKeyReader(raw,{credentials=readDigiKeyCredentials,exchange=requestDigiKey,prohibitedRoots=[],timeoutMs=20000}={}){
  const parsed=digiKeyConfigSchema.safeParse(raw),config=parsed.success?parsed.data:null;
  const registration=(item,pkg)=>config?.products.find(p=>p.manufacturer===item.manufacturer&&p.mpn===item.mpn&&p.packaging===item.packaging&&
    p.manufacturer===pkg?.identity.vendor.value&&p.mpn===pkg?.identity.model.value&&p.hardwareRevision===pkg?.identity.hardwareRevision.value);
  return {available:!!config,reason:config?'DigiKey product reads are configured; credential availability is checked only when requested.':'DigiKey API access is not configured. Public-page observations do not qualify live pricing.',
    supports:(item,pkg)=>!item.dnp&&!!registration(item,pkg),
    async observe(item,pkg,{authorize=()=>{},projectRoot}={}){
      const selected=registration(item,pkg);if(!selected||item.dnp)throw Object.assign(Error('This exact BOM part, packaging and module revision is not registered for DigiKey.'),{status:409});
      integer.refine(n=>n>0&&n<=100000).parse(item.quantity);authorize();
      const controller=new AbortController();let timer;
      try{
        const work=(async()=>{const creds=await credentials(config.credentialFile,{prohibitedRoots:[...prohibitedRoots,projectRoot]});authorize();controller.signal.throwIfAborted();
          const tokenBody=await exchange('token',{credentials:creds,signal:controller.signal});authorize();controller.signal.throwIfAborted();
          if(!Buffer.isBuffer(tokenBody)||tokenBody.length>16384)throw fail('DigiKey token response is invalid.');
          const token=z.object({access_token:z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/),expires_in:z.number().min(30),token_type:z.literal('Bearer')}).parse(JSON.parse(tokenBody.toString('utf8')));
          const body=await exchange('product',{credentials:creds,accessToken:token.access_token,productSku:selected.sku,signal:controller.signal});authorize();controller.signal.throwIfAborted();
          const observedAt=new Date().toISOString(),result=normalizeDigiKeyProduct(body,{registration:selected,quantity:item.quantity,accountId:creds.accountId,observedAt});
          return distributorObservationSchema.parse({status:'retrieved',observedAt,...result,hardwareRevisionVerified:false,
            reason:'Saved standard-price observation only. Shipping, tax, tariffs, order multiples and shipped hardware revision require separate review.'});})();
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('DigiKey retrieval timed out; no retry was attempted.'));},timeoutMs);});
        return await Promise.race([work,timeout]);
      }catch(error){authorize();return distributorObservationSchema.parse({status:'unavailable',observedAt:new Date().toISOString(),reason:error.distributorReason||'DigiKey retrieval failed; no BOM facts were changed.',offer:null,priceBreakQuantity:null,minimumOrderQuantity:null,sourceHash:null,hardwareRevisionVerified:false});}
      finally{clearTimeout(timer);controller.abort();}
    }};
}
