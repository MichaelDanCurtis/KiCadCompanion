import {z} from 'zod';

const nonEmpty=z.string().trim().min(1).max(1000);
const positive=z.number().finite().positive();
const sha256=z.string().regex(/^[a-f0-9]{64}$/i);
const targetSchema=z.object({vendor:nonEmpty,model:nonEmpty,hardwareRevision:nonEmpty}).strict();
const measurementSchema=z.object({criterion:nonEmpty,value:nonEmpty,unit:nonEmpty,tolerance:nonEmpty,observedAt:z.string().datetime(),evidence:nonEmpty}).strict();

export const physicalAcceptanceSchema=z.object({
  schemaVersion:z.literal(1),status:z.literal('accepted'),recordRevision:nonEmpty,target:targetSchema,
  unit:z.object({serial:nonEmpty,mainBoardMarking:nonEmpty,mainBoardRevision:nonEmpty}).strict(),
  software:z.object({firmwareRevision:nonEmpty,firmwareSha256:sha256,protocolRevision:nonEmpty}).strict(),
  authorization:z.object({flashApproved:z.literal(true),powerApproved:z.literal(true),approvedBy:nonEmpty}).strict(),
  power:z.object({source:nonEmpty,voltageV:positive,maxCurrentMA:positive}).strict(),
  equipment:z.array(nonEmpty).min(1).max(50),operator:nonEmpty,
  measurements:z.array(measurementSchema).min(1).max(200),
  fit:z.object({enclosureRevision:nonEmpty,fitPass:z.literal(true),connectorAccess:nonEmpty,antennaThermalCheck:nonEmpty}).strict(),
  failures:z.array(nonEmpty).max(100),simulatedValuesPresent:z.literal(false),
}).strict().superRefine((record,ctx)=>{
  if(record.unit.mainBoardRevision!==record.target.hardwareRevision)
    ctx.addIssue({code:'custom',path:['unit','mainBoardRevision'],message:'unit board revision does not match target'});
  if(record.measurements.some(m=>m.evidence.toLowerCase().includes('simulated')))
    ctx.addIssue({code:'custom',path:['measurements'],message:'measurement evidence cannot be simulated'});
  if(record.failures.length)ctx.addIssue({code:'custom',path:['failures'],message:'failed acceptance items must be resolved before status accepted'});
});

function formatIssues(error){return error.issues.map(issue=>`${issue.path.join('.')||'record'}: ${issue.message}`);}

export function validatePhysicalAcceptance(raw,{expectedTarget,expectedFirmwareRevision}={}) {
  const blockers=[],parsed=physicalAcceptanceSchema.safeParse(raw);
  if(!parsed.success)blockers.push(...formatIssues(parsed.error));
  if(parsed.success&&expectedTarget)for(const key of ['vendor','model','hardwareRevision'])
    if(parsed.data.target[key]!==expectedTarget[key])blockers.push(`target.${key}: expected ${expectedTarget[key]}, got ${parsed.data.target[key]}`);
  if(parsed.success&&expectedFirmwareRevision&&parsed.data.software.firmwareRevision!==expectedFirmwareRevision)
    blockers.push(`software.firmwareRevision: expected ${expectedFirmwareRevision}, got ${parsed.data.software.firmwareRevision}`);
  return {valid:blockers.length===0,blockers,record:parsed.success?parsed.data:null,hardwareActionAuthorized:false,acceptanceAuthorized:false};
}

