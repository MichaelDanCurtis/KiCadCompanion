import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {BlockList,isIPv4} from 'node:net';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {publicSourceUrl} from '../shared/modules.mjs';

const text=z.string().trim().min(1).max(240);
const fetchUrl=publicSourceUrl.refine(value=>{const u=new URL(value);return !u.port&&!u.hash;},'Source retrieval requires standard HTTPS without a fragment.');
export const moduleSourceConfigSchema=z.object({schemaVersion:z.literal(1),sources:z.array(z.object({
  url:fetchUrl,manufacturer:text,model:text,hardwareRevision:text,kind:z.enum(['manufacturer','distributor']),
}).strict()).max(20)}).strict().superRefine((value,ctx)=>{
  if(new Set(value.sources.map(s=>JSON.stringify(s))).size!==value.sources.length)ctx.addIssue({code:'custom',message:'Duplicate source registration'});
});
export const sourceObservationSchema=z.object({status:z.enum(['retrieved','unavailable']),observedAt:z.string().datetime(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),bytes:z.number().int().nonnegative(),
  mediaType:z.enum(['text/plain','text/html','application/json','application/pdf']).nullable(),
  excerpt:z.string().max(4000),excerptTruncated:z.boolean(),reason:z.string().max(240),
}).strict();

// Deliberately IPv4-only for this bounded public-document adapter. DNS results
// are checked before a pinned lookup is supplied to TLS; there is no second DNS
// lookup, redirect following, proxy, cookie jar, authorization or client cert.
const reserved=new BlockList();
for(const [address,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],
  ['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])reserved.addSubnet(address,bits);
export const publicSourceAddress=address=>isIPv4(address)&&!reserved.check(address);
const failure=reason=>Object.assign(Error(reason),{sourceReason:reason});
const maxBytes=4*1024*1024;
const mediaTypes=new Set(['text/plain','text/html','application/json','application/pdf']);

export async function readPublicSource(url,{resolve=lookup,request=httpsRequest,signal}={}) {
  fetchUrl.parse(url);signal?.throwIfAborted();
  const host=new URL(url).hostname;
  const addresses=await resolve(host,{family:4,all:true});signal?.throwIfAborted();
  if(!addresses.length||addresses.some(item=>!publicSourceAddress(item.address)))throw failure('Source DNS did not resolve exclusively to public IPv4 addresses.');
  const address=addresses[0].address;
  return new Promise((resolveResult,reject)=>{
    const req=request(url,{method:'GET',agent:false,proxyEnv:{},family:4,autoSelectFamily:false,
      servername:host,rejectUnauthorized:true,signal,maxHeaderSize:16384,
      lookup:(_host,options,done)=>options.all?done(null,[{address,family:4}]):done(null,address,4),
      headers:{Accept:'application/pdf, application/json, text/plain, text/html','Accept-Encoding':'identity','User-Agent':'Benchline-source-review/1'},
    },res=>{
      const rejectResponse=reason=>{res.destroy();reject(failure(reason));};
      if(res.statusCode!==200)return rejectResponse('Source returned an unavailable HTTP status; redirects are not followed.');
      const mediaType=String(res.headers['content-type']||'').split(';')[0].trim().toLowerCase();
      if(!mediaTypes.has(mediaType))return rejectResponse('Source format is unsupported.');
      if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity')return rejectResponse('Compressed source response is unsupported.');
      if(res.headers['content-length']&&(!/^\d+$/.test(res.headers['content-length'])||Number(res.headers['content-length'])>maxBytes))return rejectResponse('Source exceeds the 4 MiB response limit.');
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)return rejectResponse('Source exceeds the 4 MiB response limit.');chunks.push(chunk);});
      res.on('error',reject);res.on('aborted',()=>reject(failure('Source response was interrupted.')));
      res.on('end',()=>resolveResult({body:Buffer.concat(chunks),mediaType}));
    });
    req.on('error',reject);req.end();
  });
}

export function createModuleSourceReader(raw,{read=readPublicSource,now=()=>new Date().toISOString(),timeoutMs=15000}={}) {
  const config=moduleSourceConfigSchema.safeParse(raw);
  const registrations=config.success?config.data.sources:[];
  const registration=(pkg,source)=>registrations.find(s=>s.url===source.url&&
    s.manufacturer===pkg.identity.vendor.value&&s.model===pkg.identity.model.value&&s.hardwareRevision===pkg.identity.hardwareRevision.value);
  return {
    available:registrations.length>0,
    reason:registrations.length?'Explicit source checks are configured. Retrieval does not confirm engineering facts.':'Live retrieval is not configured for an exact module and source URL.',
    supports:(pkg,source)=>Boolean(registration(pkg,source)),
    async observe(pkg,source) {
      if(!registration(pkg,source))throw Object.assign(Error('This exact module revision and source URL are not enabled for retrieval.'),{status:409});
      const controller=new AbortController();let timer;
      try {
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('Source retrieval timed out.'));},timeoutMs);});
        const {body,mediaType}=await Promise.race([read(source.url,{signal:controller.signal}),timeout]);
        if(!Buffer.isBuffer(body)||body.length>maxBytes||!mediaTypes.has(mediaType))throw failure('Source response is invalid or too large.');
        const content=mediaType==='application/pdf'?'':body.toString('utf8');
        return sourceObservationSchema.parse({status:'retrieved',observedAt:now(),sha256:createHash('sha256').update(body).digest('hex'),
          bytes:body.length,mediaType,excerpt:content.slice(0,4000),excerptTruncated:content.length>4000,
          reason:mediaType==='application/pdf'?'PDF content hash recorded; review the source document. No facts were extracted.':'Untrusted source excerpt only; no facts were confirmed.'});
      }catch(error){return sourceObservationSchema.parse({status:'unavailable',observedAt:now(),sha256:null,bytes:0,mediaType:null,
        excerpt:'',excerptTruncated:false,reason:error.sourceReason||'Source retrieval failed; no facts were changed.'});}
      finally{clearTimeout(timer);controller.abort();}
    },
  };
}
