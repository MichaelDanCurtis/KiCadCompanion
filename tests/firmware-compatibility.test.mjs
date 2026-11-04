import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFirmwareBuildRecord,satisfiesRequirement} from '../shared/firmware-compatibility.mjs';

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
function build(overrides={}){return {schemaVersion:1,contractRevision:'BL09-contract-1',sourceRevision:'eye-v2.2-review-1',target,
  idfVersion:'5.4.4',idfRequirement:'>=5.4',toolchain:{name:'xtensa-esp-elf',version:'esp-14.2.0',archiveSha256:'a'.repeat(64)},
  artifacts:[{path:'build/app.bin',sha256:'b'.repeat(64)}],...overrides};}

test('accepts multiple compatible ESP-IDF releases with concrete build records',()=>{
  for(const idfVersion of ['5.4.4','5.5.5','6.0.0']){
    const result=validateFirmwareBuildRecord(build({idfVersion}),{expectedTarget:target,expectedSourceRevision:'eye-v2.2-review-1',expectedIdfRequirement:'>=5.4'});
    assert.equal(result.valid,true,`${idfVersion}: ${result.blockers.join('; ')}`);
  }
});

test('rejects a release below the compatibility floor and malformed requirements',()=>{
  assert.equal(validateFirmwareBuildRecord(build({idfVersion:'5.3.2'})).valid,false);
  assert.equal(validateFirmwareBuildRecord(build({idfRequirement:'latest'})).valid,false);
  assert.equal(satisfiesRequirement('5.4.4','>=5.4').supported,true);
});

test('keeps target and source revision freshness bound to each build record',()=>{
  const result=validateFirmwareBuildRecord(build({target:{...target,hardwareRevision:'v2.1'}}),{expectedTarget:target,expectedSourceRevision:'eye-v2.2-review-2'});
  assert.ok(result.blockers.some(blocker=>blocker.includes('target.hardwareRevision')));
  assert.ok(result.blockers.some(blocker=>blocker.includes('stale build')));
});

test('requires concrete toolchain and hashed artifacts for reproducibility',()=>{
  const result=validateFirmwareBuildRecord(build({toolchain:null,artifacts:[]}));
  assert.equal(result.valid,false);
  assert.ok(result.blockers.some(blocker=>blocker.includes('toolchain')));
  assert.ok(result.blockers.some(blocker=>blocker.includes('artifacts')));
});
