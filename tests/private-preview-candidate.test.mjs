import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePrivatePreviewCandidate} from '../shared/private-preview-candidate.mjs';
import pending from '../docs/benchline/release/ESP32-S3-EYE-v2.2-private-preview.pending.json' with {type:'json'};

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
const sha=(n)=>String(n).repeat(64);
function complete(overrides={}){
  const packageFiles=['benchline-preview.zip','hashes.json','sbom.json','notices.json','INSTALL.md','ROLLBACK.md'];
  const packageData=Object.fromEntries(packageFiles.map((path,index)=>[['archive','hashManifest','sbom','notices','installGuide','rollbackGuide'][index],{path,sha256:sha(index+1),sizeBytes:index?100:1000}]));
  return {schemaVersion:1,status:'private-candidate',candidateRevision:'candidate-1',sourceRevision:'source-1',target,
    package:packageData,environment:{platform:'macos',osVersion:'macOS 27',nodeVersion:'22.23.0',supportedTools:['Benchline 0.1.0','KiCad 10.0.6'],unsupportedPlatforms:['Windows','Linux']},
    privacy:{credentialScan:'pass',personalDataScan:'pass',customerFileScan:'pass',vendorAssetScan:'pass',inheritedPermissionScan:'pass'},
    softwareJourney:{environment:'fresh disposable macOS account',installObservedAt:'2026-09-11T01:00:00.000Z',openSamplePass:true,toolDiscoveryPass:true,approvedJourneyPass:true,uninstallObservedAt:'2026-09-11T02:00:00.000Z',customerFilesPreserved:true},
    rollback:{observedAt:'2026-09-11T03:00:00.000Z',pass:true,recoverySteps:['restore prior package','reopen sample project']},
    prerequisites:{bl12EvidenceRevision:'BL12-1',bl12Accepted:true,bl13EvidenceRevision:'BL13-1',bl13Accepted:true},
    release:{publicationBlocked:true,ownerDecisions:['choose license','approve private distribution'],licenseUnknowns:['native redistribution terms']},...overrides};
}

test('accepts a complete candidate record while withholding install and publication authority',()=>{const result=validatePrivatePreviewCandidate(complete(),{expectedTarget:target,expectedSourceRevision:'source-1'});assert.equal(result.valid,true);assert.deepEqual(result.blockers,[]);assert.equal(result.installAuthorized,false);assert.equal(result.publishAuthorized,false);});
test('rejects the pending candidate and reports its missing prerequisites',()=>{const result=validatePrivatePreviewCandidate(pending,{expectedTarget:target});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('versioned package archive')));assert.ok(result.blockers.some(b=>b.includes('BL-12 software scenario')));assert.ok(result.blockers.some(b=>b.includes('BL-13 physical acceptance')));});
test('reports intentional pending-record blockers without schema noise',()=>{const result=validatePrivatePreviewCandidate(pending,{expectedTarget:target});assert.ok(result.blockers.every(b=>b.startsWith('pending: ')));assert.ok(result.blockers.some(b=>b.includes('BL-12 software scenario')));assert.ok(result.blockers.some(b=>b.includes('BL-13 physical acceptance')));});
test('rejects stale source and target revisions',()=>{const result=validatePrivatePreviewCandidate(complete({target:{...target,hardwareRevision:'v2.1'}}),{expectedTarget:target,expectedSourceRevision:'source-2'});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('target.hardwareRevision')));assert.ok(result.blockers.some(b=>b.includes('stale candidate')));});
test('rejects duplicate package paths and unsafe release facts',()=>{const result=validatePrivatePreviewCandidate(complete({package:{...complete().package,notices:{...complete().package.archive}}}),{expectedTarget:target});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('paths must be unique')));const bad=validatePrivatePreviewCandidate(complete({softwareJourney:{...complete().softwareJourney,customerFilesPreserved:false}}),{expectedTarget:target});assert.equal(bad.valid,false);assert.ok(bad.blockers.some(b=>b.includes('customerFilesPreserved')));});
