import {z} from 'zod';

const nonEmpty=z.string().trim().min(1).max(400);
const sha256=z.string().regex(/^[a-f0-9]{64}$/i,'must be a SHA-256 hash');
const targetSchema=z.object({vendor:nonEmpty,model:nonEmpty,hardwareRevision:nonEmpty}).strict();
const versionPattern=/^([0-9]+)\.([0-9]+)(?:\.([0-9]+))?(?:[-+][0-9A-Za-z.-]+)?$/;
const version=z.string().trim().regex(versionPattern,'must be a semantic version such as 5.4.4');
const artifact=z.object({path:z.string().trim().min(1).max(1000),sha256}).strict();

/**
 * A build record carries the concrete SDK/toolchain used for one reproducible
 * build. The product contract can therefore support a compatible ESP-IDF
 * range without pretending that every build used the same release.
 */
export const firmwareBuildRecordSchema=z.object({
  schemaVersion:z.literal(1),
  contractRevision:nonEmpty,
  sourceRevision:nonEmpty,
  target:targetSchema,
  idfVersion:version,
  idfRequirement:nonEmpty,
  toolchain:z.object({name:nonEmpty,version:nonEmpty,archiveSha256:sha256}).strict(),
  artifacts:z.array(artifact).min(1).max(100),
}).strict();

function parseVersion(value){
  const match=versionPattern.exec(String(value).trim());
  return match?{major:Number(match[1]),minor:Number(match[2]),patch:Number(match[3]??0)}:null;
}

function satisfiesRequirement(idfVersion,idfRequirement){
  const actual=parseVersion(idfVersion);
  const match=/^>=\s*([0-9]+)\.([0-9]+)(?:\.([0-9]+))?$/.exec(String(idfRequirement).trim());
  if(!actual||!match)return {supported:false,reason:'only a simple >= major.minor[.patch] requirement is supported'};
  const minimum={major:Number(match[1]),minor:Number(match[2]),patch:Number(match[3]??0)};
  const supported=actual.major>minimum.major ||
    (actual.major===minimum.major && (actual.minor>minimum.minor ||
      (actual.minor===minimum.minor && actual.patch>=minimum.patch)));
  return {supported,reason:supported?null:`ESP-IDF ${idfVersion} is below required ${idfRequirement}`};
}

function formatIssues(error){return error.issues.map(issue=>`${issue.path.join('.')||'build'}: ${issue.message}`);}

/** Validate one concrete build against a compatible-release policy. */
export function validateFirmwareBuildRecord(raw,{expectedTarget,expectedSourceRevision,expectedIdfRequirement}={}){
  const blockers=[];
  const parsed=firmwareBuildRecordSchema.safeParse(raw);
  if(!parsed.success)blockers.push(...formatIssues(parsed.error));
  if(parsed.success){
    const requirement=expectedIdfRequirement??parsed.data.idfRequirement;
    const compatibility=satisfiesRequirement(parsed.data.idfVersion,requirement);
    if(!compatibility.supported)blockers.push(`idfVersion: ${compatibility.reason}`);
    if(expectedTarget)for(const key of ['vendor','model','hardwareRevision'])
      if(parsed.data.target[key]!==expectedTarget[key])blockers.push(`target.${key}: expected ${expectedTarget[key]}, got ${parsed.data.target[key]}`);
    if(expectedSourceRevision&&parsed.data.sourceRevision!==expectedSourceRevision)
      blockers.push(`sourceRevision: stale build; expected ${expectedSourceRevision}, got ${parsed.data.sourceRevision}`);
  }
  return {valid:blockers.length===0,blockers,build:parsed.success?parsed.data:null};
}

export {parseVersion,satisfiesRequirement};
