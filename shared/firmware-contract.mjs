import {z} from 'zod';

const nonEmpty=z.string().trim().min(1).max(400);
const commit=z.string().regex(/^[a-f0-9]{40}$/i,'must be a 40 character commit hash');
const pin=z.string().trim().regex(/^(?:GPIO)?[0-9]+$/i,'must name a GPIO, for example GPIO0');
const sha256=z.string().regex(/^[a-f0-9]{64}$/i,'must be a SHA-256 hash');
const targetSchema=z.object({vendor:nonEmpty,model:nonEmpty,hardwareRevision:nonEmpty}).strict();

const interfaceSchema=z.object({name:nonEmpty,transport:nonEmpty,details:nonEmpty}).strict();
const commandSchema=z.object({name:nonEmpty,request:nonEmpty,response:nonEmpty}).strict();
const timeoutSchema=z.object({startupMs:z.number().int().positive(),commandMs:z.number().int().positive(),errorPolicy:nonEmpty}).strict();
const powerSchema=z.object({minSupplyV:z.number().finite().positive(),maxSupplyV:z.number().finite().positive(),maxCurrentMA:z.number().finite().positive()}).strict();

/**
 * A complete contract is intentionally smaller than an application or board
 * package. It is the input boundary for an offline firmware build; unresolved
 * owner decisions must stay in the pending contract and cannot parse here.
 */
export const firmwareContractSchema=z.object({
  schemaVersion:z.literal(1),
  status:z.literal('approved'),
  contractRevision:nonEmpty,
  sourceRevision:nonEmpty,
  target:targetSchema,
  bsp:z.object({version:nonEmpty,commit,idfRequirement:nonEmpty,exactSdkVersion:nonEmpty,
    toolchain:z.object({name:nonEmpty,version:nonEmpty,archiveSha256:sha256}).strict()}).strict(),
  requirements:z.object({interfaces:z.array(interfaceSchema).min(1).max(20),commands:z.array(commandSchema).min(1).max(100),
    safeStartup:nonEmpty,timeoutsAndErrors:timeoutSchema,approvedBy:nonEmpty}).strict(),
  electrical:z.object({reservedPins:z.array(pin).min(1).max(100),usedPins:z.array(pin).max(100),powerLimits:powerSchema,
    completePinInventory:z.literal(true),sourceRevisionConflicts:z.array(nonEmpty).max(100)}).strict(),
}).strict().superRefine((contract,ctx)=>{
  if(contract.electrical.powerLimits.minSupplyV>contract.electrical.powerLimits.maxSupplyV)
    ctx.addIssue({code:'custom',path:['electrical','powerLimits'],message:'minimum supply exceeds maximum supply'});
  const duplicates=contract.electrical.reservedPins.filter((p,i,a)=>a.indexOf(p)!==i);
  if(duplicates.length)ctx.addIssue({code:'custom',path:['electrical','reservedPins'],message:`duplicate reserved pin ${duplicates[0]}`});
  const reserved=new Set(contract.electrical.reservedPins.map(canonicalPin));
  for(const used of contract.electrical.usedPins)
    if(reserved.has(canonicalPin(used)))ctx.addIssue({code:'custom',path:['electrical','usedPins'],message:`pin conflict: ${used} is reserved`});
  if(contract.electrical.sourceRevisionConflicts.length)
    ctx.addIssue({code:'custom',path:['electrical','sourceRevisionConflicts'],message:'source revision conflicts must be resolved'});
});

const forbiddenKey=/credential|secret|token|password|api[_-]?key|private[_-]?key/i;
const canonicalPin=value=>value.toUpperCase().startsWith('GPIO')?value.toUpperCase():`GPIO${value}`;
function forbiddenKeys(value,path='') {
  if(!value||typeof value!=='object')return [];
  const found=[];
  for(const [key,child] of Object.entries(value)) {
    const childPath=path?`${path}.${key}`:key;
    if(forbiddenKey.test(key))found.push(childPath);
    found.push(...forbiddenKeys(child,childPath));
  }
  return found;
}

function formatIssues(error) {
  return error.issues.map(issue=>`${issue.path.join('.')||'contract'}: ${issue.message}`);
}

/** Validate a complete, owner-approved contract without authorizing a build or flash. */
export function validateFirmwareContract(raw,{expectedTarget,expectedSourceRevision}={}) {
  const blockers=[];
  const forbidden=forbiddenKeys(raw);
  if(forbidden.length)blockers.push(`forbidden credential-bearing field: ${forbidden[0]}`);
  const parsed=firmwareContractSchema.safeParse(raw);
  if(!parsed.success)blockers.push(...formatIssues(parsed.error));
  if(parsed.success&&expectedTarget) {
    for(const key of ['vendor','model','hardwareRevision'])
      if(parsed.data.target[key]!==expectedTarget[key])blockers.push(`target.${key}: expected ${expectedTarget[key]}, got ${parsed.data.target[key]}`);
  }
  if(parsed.success&&expectedSourceRevision&&parsed.data.sourceRevision!==expectedSourceRevision)
    blockers.push(`sourceRevision: stale contract; expected ${expectedSourceRevision}, got ${parsed.data.sourceRevision}`);
  return {valid:blockers.length===0,blockers,contract:parsed.success?parsed.data:null,buildAuthorized:false,flashAuthorized:false};
}

const firmwareArtifactSchema=z.object({path:z.string().trim().min(1).max(1000),content:z.string().max(16*1024*1024)}).strict();
const credentialContent=/(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|private[_-]?key)\s*[:=]|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}/i;
const machinePath=/(?:^|["'\s=:(])(?:\/Users\/|\/Volumes\/|\/private\/tmp\/|\/home\/|[A-Za-z]:[\\/])/;

/** Check generated source/build text for non-portable paths and credentials. */
export function inspectFirmwareArtifacts(raw) {
  const items=Array.isArray(raw)?raw:Object.entries(raw||{}).map(([path,content])=>({path,content}));
  const blockers=[];
  for(const candidate of items) {
    const parsed=firmwareArtifactSchema.safeParse(candidate);
    if(!parsed.success){blockers.push(...formatIssues(parsed.error).map(issue=>`artifact: ${issue}`));continue;}
    const {path,content}=parsed.data;
    if(path.startsWith('/')||/^[A-Za-z]:[\\/]/.test(path)||path.split('/').includes('..'))blockers.push(`${path}: artifact locator is not workspace-relative`);
    if(credentialContent.test(content))blockers.push(`${path}: possible credential or private key`);
    if(machinePath.test(content))blockers.push(`${path}: machine-specific absolute path`);
  }
  if(!items.length)blockers.push('No firmware artifacts were supplied');
  return {clean:blockers.length===0,blockers,artifactCount:items.length};
}
