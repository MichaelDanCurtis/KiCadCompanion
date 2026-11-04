import {z} from 'zod';

export const moduleImportMaxBytes=512*1024;

const id=z.string().uuid(),short=z.string().trim().min(1).max(240),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const publicSourceUrl=z.string().url().max(2000).refine(value=>{
  const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&
    !/^[\d.]+$/.test(u.hostname)&&!u.hostname.includes(':')&&!/(^|\.)(localhost|local|internal)$/.test(u.hostname)&&u.hostname.includes('.');
},'Use a public HTTPS source locator without credentials or query tokens.');
const sourceRef=z.object({sourceId:id,locator:short}).strict();
export const factStatus=z.enum(['proposed','source-verified','user-confirmed','conflicting','unknown']);
const fact=value=>z.object({value:value.nullable(),unit:short.nullable(),status:factStatus,
  sources:z.array(sourceRef).max(20),note:z.string().max(2000).default('')}).strict().superRefine((f,ctx)=>{
    if(f.value===null&&f.status!=='unknown')ctx.addIssue({code:'custom',message:'A missing value must remain explicitly unknown'});
    if(f.status==='unknown'&&f.value!==null)ctx.addIssue({code:'custom',message:'Unknown facts cannot contain an asserted value'});
    if(['source-verified','user-confirmed'].includes(f.status)&&!f.sources.length)ctx.addIssue({code:'custom',message:'Verified or confirmed facts need source references'});
  });
const textFact=fact(short),numberFact=fact(z.number().finite().nonnegative()),boolFact=fact(z.boolean()),listFact=fact(z.array(short).max(100));
export const moduleSourceSchema=z.object({id,title:short,url:publicSourceUrl,version:short.nullable(),
  retrievedAt:z.string().datetime().nullable(),sha256:hash.nullable(),license:z.string().max(500).nullable(),
  // Optional without a default: old persisted package hashes must not change.
  revisionStatus:z.enum(['unreviewed','consistent','conflicting']).optional()}).strict();
export const modulePackageSchema=z.object({schemaVersion:z.literal(1),id,
  identity:z.object({vendor:textFact,model:textFact,hardwareRevision:textFact}).strict(),
  pinInventoryComplete:boolFact,
  pins:z.array(z.object({id,number:short,name:textFact,interfaces:listFact,reserved:boolFact,
    maxVoltageV:numberFact,maxCurrentMA:numberFact}).strict()).max(300),
  power:z.object({minSupplyV:numberFact,maxSupplyV:numberFact,maxCurrentMA:numberFact}).strict(),
  dimensions:z.object({widthMM:numberFact,heightMM:numberFact,depthMM:numberFact}).strict(),
  assets:z.array(z.object({id,kind:z.enum(['footprint','symbol','model','drawing']),name:short,
    source:sourceRef,sha256:hash.nullable(),license:z.string().max(500).nullable(),
    reuseStatus:z.enum(['unknown','not-permitted','review-required'])}).strict()).max(100),
  firmware:z.array(z.object({id,sdk:textFact,version:textFact,source:sourceRef}).strict()).max(100),
  sources:z.array(moduleSourceSchema).max(100),notes:z.string().max(10000).default(''),
}).strict().superRefine((pkg,ctx)=>{
  const sources=new Set(pkg.sources.map(s=>s.id));
  if(sources.size!==pkg.sources.length)ctx.addIssue({code:'custom',message:'Duplicate source ID'});
  if(new Set(pkg.pins.map(p=>p.number)).size!==pkg.pins.length)ctx.addIssue({code:'custom',message:'Duplicate pin number'});
  const ids=[...pkg.pins,...pkg.assets,...pkg.firmware].map(p=>p.id);
  if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'Duplicate module item ID'});
  for(const [path,f] of moduleFacts(pkg))for(const ref of f.sources)if(!sources.has(ref.sourceId))ctx.addIssue({code:'custom',message:`Missing source for ${path}`});
  for(const item of [...pkg.assets,...pkg.firmware])if(!sources.has(item.source.sourceId))ctx.addIssue({code:'custom',message:'Missing asset or firmware source'});
  const units=[...Object.entries(pkg.power).map(([key,f])=>[f,key==='maxCurrentMA'?'mA':'V']),
    ...Object.values(pkg.dimensions).map(f=>[f,'mm']),...pkg.pins.flatMap(p=>[[p.maxVoltageV,'V'],[p.maxCurrentMA,'mA']])];
  for(const [f,unit] of units)if(f.unit!==unit)ctx.addIssue({code:'custom',message:`Electrical/dimensional field must use ${unit}`});
  if(pkg.power.minSupplyV.value!==null&&pkg.power.maxSupplyV.value!==null&&pkg.power.minSupplyV.value>pkg.power.maxSupplyV.value)
    ctx.addIssue({code:'custom',message:'Minimum supply exceeds maximum supply'});
});

// Stable host-defined field addresses; imports cannot inject arbitrary setters.
export function moduleFacts(pkg) {
  return [...Object.entries(pkg.identity).map(([key,f])=>[`identity.${key}`,f]),['pinInventoryComplete',pkg.pinInventoryComplete],
    ...Object.entries(pkg.power).map(([key,f])=>[`power.${key}`,f]),...Object.entries(pkg.dimensions).map(([key,f])=>[`dimensions.${key}`,f]),
    ...pkg.pins.flatMap(p=>['name','interfaces','reserved','maxVoltageV','maxCurrentMA'].map(key=>[`pins.${p.id}.${key}`,p[key]])),
    ...pkg.firmware.flatMap(f=>['sdk','version'].map(key=>[`firmware.${f.id}.${key}`,f[key]]))];
}

export function moduleDesignReadiness(raw) {
  const pkg=modulePackageSchema.parse(raw),blockers=[];
  for(const source of pkg.sources)if(source.revisionStatus==='conflicting'||source.revisionStatus==='unreviewed')
    blockers.push(`${source.title}: source revision is ${source.revisionStatus}; review a separate sourced proposal.`);
  for(const [path,f] of moduleFacts(pkg)) {
    if(!['source-verified','user-confirmed'].includes(f.status)||f.value===null)blockers.push(`${path}: ${f.status}`);
    for(const ref of f.sources){const source=pkg.sources.find(s=>s.id===ref.sourceId);if(!source.version||!source.sha256||!source.retrievedAt)blockers.push(`${path}: source version, content hash or retrieval date is unknown`);}
  }
  if(pkg.pinInventoryComplete.value!==true||!pkg.pins.length)blockers.push('Complete pin inventory is not confirmed');
  if(!pkg.assets.length)blockers.push('No reviewed footprint/model/drawing asset references');
  for(const asset of pkg.assets){const source=pkg.sources.find(s=>s.id===asset.source.sourceId);
    if(!asset.sha256||!asset.license||asset.reuseStatus!=='review-required'||!source.version||!source.sha256||!source.retrievedAt)
      blockers.push(`${asset.name}: versioned asset source, hash/license or reuse review is unresolved`);}
  if(!pkg.firmware.length)blockers.push('Firmware source/version references are unknown');
  // A reference review never grants reuse rights or native action authority.
  return {ready:blockers.length===0,blockers,executionAuthorized:false,assetReuseAuthorized:false};
}

const offerSchema=z.object({id,distributor:short,sku:short,manufacturer:short,mpn:short,packaging:short,
  requestedQuantity:z.number().int().positive(),currency:z.string().regex(/^[A-Z]{3}$/),unitPrice:z.string().regex(/^\d+(?:\.\d{1,8})?$/).nullable(),
  availableQuantity:z.number().int().nonnegative().nullable(),observedAt:z.string().datetime(),sourceUrl:publicSourceUrl,
  sourceHash:hash,substitute:z.boolean()}).strict();
export {offerSchema as bomOfferSchema};
export const bomSchema=z.object({schemaVersion:z.literal(1),id,revision:z.number().int().positive(),name:short,
  items:z.array(z.object({id,references:z.array(short).min(1).max(1000),manufacturer:short,mpn:short,
    quantity:z.number().int().positive(),dnp:z.boolean(),packaging:short,
    moduleRef:z.object({id,revision:z.number().int().positive(),sha256:hash}).strict().nullable(),
    offers:z.array(offerSchema).max(100),proposedSubstitutes:z.array(z.object({manufacturer:short,mpn:short,reason:short}).strict()).max(100),
  }).strict()).max(1000)}).strict().superRefine((bom,ctx)=>{
    if(new Set(bom.items.map(i=>i.id)).size!==bom.items.length)ctx.addIssue({code:'custom',message:'Duplicate BOM item ID'});
    const refs=bom.items.flatMap(i=>i.references);if(new Set(refs).size!==refs.length)ctx.addIssue({code:'custom',message:'Duplicate BOM reference'});
    for(const item of bom.items)for(const offer of item.offers)if(!offer.substitute&&(offer.manufacturer!==item.manufacturer||offer.mpn!==item.mpn||offer.packaging!==item.packaging))
      ctx.addIssue({code:'custom',message:'Different part or packaging must remain a proposed substitute quote'});
  });
export const exportBom=raw=>JSON.stringify(bomSchema.parse(raw),null,2)+'\n';
export const importBom=text=>bomSchema.parse(JSON.parse(text));
export function bomWithSourcingObservation(raw,itemId,offer) {
  const bom=bomSchema.parse(raw),observation=offerSchema.parse(offer),item=bom.items.find(i=>i.id===itemId);
  if(!item||item.dnp||observation.substitute||observation.manufacturer!==item.manufacturer||observation.mpn!==item.mpn||
    observation.packaging!==item.packaging||observation.requestedQuantity!==item.quantity)throw Error('Sourcing observation does not match this BOM item.');
  item.offers=item.offers.filter(o=>o.id!==observation.id);item.offers.push(observation);bom.revision++;
  return bomSchema.parse(bom);
}
export function compareOffers(raw,at=new Date().toISOString()) {
  const bom=bomSchema.parse(raw);
  return bom.items.map(item=>({itemId:item.id,references:item.references,quantity:item.quantity,dnp:item.dnp,
    offers:item.offers.map(offer=>({...offer,ageHours:(Date.parse(at)-Date.parse(offer.observedAt))/3600000,
      matchesRequestedPart:!offer.substitute&&offer.manufacturer===item.manufacturer&&offer.mpn===item.mpn&&offer.packaging===item.packaging,
      coversQuantity:offer.availableQuantity===null?null:offer.availableQuantity>=item.quantity,
      quotedQuantityMatches:offer.requestedQuantity===item.quantity})),automaticReplacement:false}));
}
