import {z} from 'zod';

const nonEmpty=z.string().trim().min(1).max(1000);
const sha256=z.string().regex(/^[a-f0-9]{64}$/i);
const targetSchema=z.object({vendor:nonEmpty,model:nonEmpty,hardwareRevision:nonEmpty}).strict();
const pathSchema=z.string().trim().min(1).max(1000).refine(value=>!value.startsWith('/')&&!/^[A-Za-z]:[\\/]/.test(value)&&!value.split('/').includes('..'),'must be a workspace-relative path');
const packageArtifactSchema=z.object({path:pathSchema,sha256,sizeBytes:z.number().int().nonnegative()}).strict();
const pendingCandidateSchema=z.object({
  schemaVersion:z.literal(1),status:z.literal('awaiting-owner'),target:targetSchema,
  candidateRevision:z.null(),sourceRevision:z.null(),package:z.null(),environment:z.null(),privacy:z.null(),
  softwareJourney:z.null(),rollback:z.null(),prerequisites:z.null(),release:z.null(),
  simulatedValuesPresent:z.literal(true),blockers:z.array(nonEmpty).min(1).max(100),
}).strict();

export const privatePreviewCandidateSchema=z.object({
  schemaVersion:z.literal(1),status:z.literal('private-candidate'),candidateRevision:nonEmpty,sourceRevision:nonEmpty,
  target:targetSchema,
  package:z.object({archive:packageArtifactSchema,hashManifest:packageArtifactSchema,sbom:packageArtifactSchema,notices:packageArtifactSchema,installGuide:packageArtifactSchema,rollbackGuide:packageArtifactSchema}).strict(),
  environment:z.object({platform:z.literal('macos'),osVersion:nonEmpty,nodeVersion:nonEmpty,supportedTools:z.array(nonEmpty).min(1).max(50),unsupportedPlatforms:z.array(nonEmpty).max(20)}).strict(),
  privacy:z.object({credentialScan:z.literal('pass'),personalDataScan:z.literal('pass'),customerFileScan:z.literal('pass'),vendorAssetScan:z.literal('pass'),inheritedPermissionScan:z.literal('pass')}).strict(),
  softwareJourney:z.object({environment:nonEmpty,installObservedAt:z.string().datetime(),openSamplePass:z.literal(true),toolDiscoveryPass:z.literal(true),approvedJourneyPass:z.literal(true),uninstallObservedAt:z.string().datetime(),customerFilesPreserved:z.literal(true)}).strict(),
  rollback:z.object({observedAt:z.string().datetime(),pass:z.literal(true),recoverySteps:z.array(nonEmpty).min(1).max(50)}).strict(),
  prerequisites:z.object({bl12EvidenceRevision:nonEmpty,bl12Accepted:z.literal(true),bl13EvidenceRevision:nonEmpty,bl13Accepted:z.literal(true)}).strict(),
  release:z.object({publicationBlocked:z.literal(true),ownerDecisions:z.array(nonEmpty).min(1).max(100),licenseUnknowns:z.array(nonEmpty).max(100)}).strict(),
}).strict().superRefine((candidate,ctx)=>{
  const artifacts=Object.values(candidate.package);
  const paths=artifacts.map(artifact=>artifact.path);
  if(new Set(paths).size!==paths.length)ctx.addIssue({code:'custom',path:['package'],message:'package artifact paths must be unique'});
  if(candidate.package.hashManifest.sha256===candidate.package.archive.sha256)
    ctx.addIssue({code:'custom',path:['package','hashManifest'],message:'hash manifest must be distinct from the archive'});
  if(candidate.softwareJourney.uninstallObservedAt<candidate.softwareJourney.installObservedAt)
    ctx.addIssue({code:'custom',path:['softwareJourney'],message:'uninstall observation cannot precede install observation'});
});

function formatIssues(error){return error.issues.map(issue=>`${issue.path.join('.')||'candidate'}: ${issue.message}`);}

/** Validate a complete private candidate record without authorizing install or publication. */
export function validatePrivatePreviewCandidate(raw,{expectedTarget,expectedSourceRevision}={}) {
  const blockers=[],parsed=privatePreviewCandidateSchema.safeParse(raw);
  if(!parsed.success){
    const pending=pendingCandidateSchema.safeParse(raw);
    if(pending.success)blockers.push(...pending.data.blockers.map(blocker=>`pending: ${blocker}`));
    else blockers.push(...formatIssues(parsed.error));
  }
  if(parsed.success&&expectedTarget)for(const key of ['vendor','model','hardwareRevision'])
    if(parsed.data.target[key]!==expectedTarget[key])blockers.push(`target.${key}: expected ${expectedTarget[key]}, got ${parsed.data.target[key]}`);
  if(parsed.success&&expectedSourceRevision&&parsed.data.sourceRevision!==expectedSourceRevision)
    blockers.push(`sourceRevision: stale candidate; expected ${expectedSourceRevision}, got ${parsed.data.sourceRevision}`);
  return {valid:blockers.length===0,blockers,candidate:parsed.success?parsed.data:null,installAuthorized:false,publishAuthorized:false};
}
