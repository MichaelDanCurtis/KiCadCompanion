import {z} from 'zod';

const nonEmpty=z.string().trim().min(1).max(1000);
const sha256=z.string().regex(/^[a-f0-9]{64}$/i);
const targetSchema=z.object({vendor:nonEmpty,model:nonEmpty,hardwareRevision:nonEmpty}).strict();
const artifactSchema=z.object({kind:z.enum(['electronics','firmware','mechanical','application','bom']),revision:nonEmpty,sha256}).strict();

export const integrationScenarioSchema=z.object({
  schemaVersion:z.literal(1),status:z.literal('approved'),scenarioRevision:nonEmpty,target:targetSchema,
  baseline:z.object({projectRevision:nonEmpty,boardRevision:nonEmpty,firmwareRevision:nonEmpty,mechanicalRevision:nonEmpty,applicationRevision:nonEmpty,bomRevision:nonEmpty}).strict(),
  change:z.object({kind:z.enum(['connector','module']),fromRevision:nonEmpty,toRevision:nonEmpty,description:nonEmpty}).strict(),
  thresholds:z.object({electrical:z.object({maxCurrentMA:z.number().finite().positive(),supplyToleranceV:z.number().finite().positive()}).strict(),
    mechanical:z.object({minClearanceMM:z.number().finite().nonnegative(),maxFitGapMM:z.number().finite().nonnegative()}).strict(),
    software:z.object({commandTimeoutMs:z.number().int().positive(),maxRecoveryMs:z.number().int().positive()}).strict()}).strict(),
  artifacts:z.array(artifactSchema).min(5).max(20),toolVersions:z.record(nonEmpty),recovery:z.object({checkpoint:nonEmpty,restartAt:nonEmpty,manualEditHandling:nonEmpty}).strict(),
  acceptanceChecks:z.array(nonEmpty).min(1).max(100),unresolvedWarnings:z.array(nonEmpty).max(100),physicalValidationPending:z.literal(true),
}).strict().superRefine((scenario,ctx)=>{
  if(scenario.change.fromRevision===scenario.change.toRevision)ctx.addIssue({code:'custom',path:['change'],message:'change must advance the source revision'});
  if(scenario.thresholds.mechanical.maxFitGapMM<scenario.thresholds.mechanical.minClearanceMM)
    ctx.addIssue({code:'custom',path:['thresholds','mechanical'],message:'maximum fit gap is smaller than minimum clearance'});
  const kinds=scenario.artifacts.map(a=>a.kind);
  if(new Set(kinds).size!==kinds.length)ctx.addIssue({code:'custom',path:['artifacts'],message:'artifact kinds must be unique'});
  for(const required of ['electronics','firmware','mechanical','application','bom'])if(!kinds.includes(required))
    ctx.addIssue({code:'custom',path:['artifacts'],message:`missing required ${required} artifact`});
});

function formatIssues(error){return error.issues.map(issue=>`${issue.path.join('.')||'scenario'}: ${issue.message}`);}

export function validateIntegrationScenario(raw,{expectedTarget,expectedScenarioRevision}={}) {
  const blockers=[],parsed=integrationScenarioSchema.safeParse(raw);
  if(!parsed.success)blockers.push(...formatIssues(parsed.error));
  if(parsed.success&&expectedTarget)for(const key of ['vendor','model','hardwareRevision'])
    if(parsed.data.target[key]!==expectedTarget[key])blockers.push(`target.${key}: expected ${expectedTarget[key]}, got ${parsed.data.target[key]}`);
  if(parsed.success&&expectedScenarioRevision&&parsed.data.scenarioRevision!==expectedScenarioRevision)
    blockers.push(`scenarioRevision: stale scenario; expected ${expectedScenarioRevision}, got ${parsed.data.scenarioRevision}`);
  return {valid:blockers.length===0,blockers,scenario:parsed.success?parsed.data:null,softwareAuthorized:false,executionAuthorized:false};
}

