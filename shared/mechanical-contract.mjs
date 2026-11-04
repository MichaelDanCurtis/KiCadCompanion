import {z} from 'zod';

const nonEmpty=z.string().trim().min(1).max(400);
const positive=z.number().finite().positive();
const finite=z.number().finite();
const targetSchema=z.object({vendor:nonEmpty,model:nonEmpty,hardwareRevision:nonEmpty}).strict();
const pointSchema=z.object({xMM:finite,yMM:finite,zMM:finite}).strict();
const envelopeSchema=z.object({widthMM:positive,lengthMM:positive,heightMM:positive}).strict();
const sourceConflict=z.array(nonEmpty).max(100);

export const mechanicalContractSchema=z.object({
  schemaVersion:z.literal(1),status:z.literal('approved'),contractRevision:nonEmpty,sourceRevision:nonEmpty,
  target:targetSchema,units:z.literal('mm'),boardOutline:z.object({widthMM:positive,lengthMM:positive}).strict(),
  assemblyEnvelope:envelopeSchema,origin:pointSchema,
  orientation:z.object({up:nonEmpty,rotationDeg:finite}).strict(),
  mountHoles:z.array(z.object({id:nonEmpty,xMM:finite,yMM:finite,diameterMM:positive}).strict()).min(1).max(100),
  connectorOpenings:z.array(z.object({id:nonEmpty,xMM:finite,yMM:finite,widthMM:positive,heightMM:positive,side:z.enum(['front','back','left','right','top','bottom'])}).strict()).max(100),
  antennaAndThermalClearances:z.object({antennaMM:positive,thermalMM:positive}).strict(),
  material:nonEmpty,printTolerances:z.object({xyMM:positive,zMM:positive}).strict(),freecadVersion:nonEmpty,
  sourceRevisionConflicts:sourceConflict,
}).strict().superRefine((contract,ctx)=>{
  if(contract.assemblyEnvelope.widthMM<contract.boardOutline.widthMM)
    ctx.addIssue({code:'custom',path:['assemblyEnvelope','widthMM'],message:'enclosure width is smaller than board outline'});
  if(contract.assemblyEnvelope.lengthMM<contract.boardOutline.lengthMM)
    ctx.addIssue({code:'custom',path:['assemblyEnvelope','lengthMM'],message:'enclosure length is smaller than board outline'});
  if(new Set(contract.mountHoles.map(h=>h.id)).size!==contract.mountHoles.length)
    ctx.addIssue({code:'custom',path:['mountHoles'],message:'mount-hole IDs must be unique'});
  if(new Set(contract.connectorOpenings.map(o=>o.id)).size!==contract.connectorOpenings.length)
    ctx.addIssue({code:'custom',path:['connectorOpenings'],message:'connector-opening IDs must be unique'});
  if(contract.sourceRevisionConflicts.length)
    ctx.addIssue({code:'custom',path:['sourceRevisionConflicts'],message:'source revision conflicts must be resolved'});
});

function formatIssues(error){return error.issues.map(issue=>`${issue.path.join('.')||'contract'}: ${issue.message}`);}

export function validateMechanicalContract(raw,{expectedTarget,expectedSourceRevision}={}) {
  const blockers=[],parsed=mechanicalContractSchema.safeParse(raw);
  if(!parsed.success)blockers.push(...formatIssues(parsed.error));
  if(parsed.success&&expectedTarget)for(const key of ['vendor','model','hardwareRevision'])
    if(parsed.data.target[key]!==expectedTarget[key])blockers.push(`target.${key}: expected ${expectedTarget[key]}, got ${parsed.data.target[key]}`);
  if(parsed.success&&expectedSourceRevision&&parsed.data.sourceRevision!==expectedSourceRevision)
    blockers.push(`sourceRevision: stale contract; expected ${expectedSourceRevision}, got ${parsed.data.sourceRevision}`);
  return {valid:blockers.length===0,blockers,contract:parsed.success?parsed.data:null,freecadAuthorized:false,writeAuthorized:false};
}

