import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFirmwareContract} from '../shared/firmware-contract.mjs';
import pending from '../docs/benchline/firmware/ESP32-S3-EYE-v2.2-contract.pending.json' with {type:'json'};

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
function complete(overrides={}) {
  return {
    schemaVersion:1,status:'approved',contractRevision:'BL09-contract-1',sourceRevision:'eye-v2.2-review-1',target,
    bsp:{version:'6.0.0',commit:'b'.repeat(40),idfRequirement:'>=5.4',exactSdkVersion:'ESP-IDF 5.4.2',
      toolchain:{name:'xtensa-esp-elf',version:'esp-14.2.0_20240906',archiveSha256:'a'.repeat(64)}},
    requirements:{interfaces:[{name:'control',transport:'UART',details:'test-only interface'}],commands:[{name:'ping',request:'PING',response:'PONG'}],
      safeStartup:'all outputs disabled',timeoutsAndErrors:{startupMs:1000,commandMs:250,errorPolicy:'return an error'},approvedBy:'synthetic review'},
    electrical:{reservedPins:['GPIO0','GPIO3'],usedPins:['GPIO4'],powerLimits:{minSupplyV:4.75,maxSupplyV:5.25,maxCurrentMA:500},completePinInventory:true,sourceRevisionConflicts:[]},
    ...overrides,
  };
}

test('accepts a complete contract while keeping build and flash authorization false',()=>{
  const result=validateFirmwareContract(complete(),{expectedTarget:target,expectedSourceRevision:'eye-v2.2-review-1'});
  assert.equal(result.valid,true);assert.deepEqual(result.blockers,[]);assert.equal(result.buildAuthorized,false);assert.equal(result.flashAuthorized,false);
});

test('rejects the pending contract and reports unresolved owner inputs',()=>{
  const result=validateFirmwareContract(pending,{expectedTarget:target});
  assert.equal(result.valid,false);
  assert.ok(result.blockers.some(b=>b.includes('bsp.exactSdkVersion')));
  assert.ok(result.blockers.some(b=>b.includes('bsp.toolchain')));
  assert.ok(result.blockers.some(b=>b.includes('requirements.interfaces')));
  assert.ok(result.blockers.some(b=>b.includes('electrical.reservedPins')));
});

test('rejects wrong board target and stale source revision',()=>{
  const wrong=complete({target:{...target,hardwareRevision:'v2.1'}});
  const result=validateFirmwareContract(wrong,{expectedTarget:target,expectedSourceRevision:'eye-v2.2-review-2'});
  assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('target.hardwareRevision')));
  assert.ok(result.blockers.some(b=>b.includes('stale contract')));
});

test('rejects reserved pin conflicts and unresolved source revision conflicts',()=>{
  const conflict=complete({electrical:{...complete().electrical,usedPins:['3'],sourceRevisionConflicts:['sub-board revision mismatch']}});
  const result=validateFirmwareContract(conflict,{expectedTarget:target,expectedSourceRevision:'eye-v2.2-review-1'});
  assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('pin conflict')));
  assert.ok(result.blockers.some(b=>b.includes('source revision conflicts')));
});

test('rejects credential-bearing fields and paths even when the rest parses',()=>{
  const contract=complete();contract.toolchain={...contract.bsp.toolchain,archivePath:'/tmp/sdk'};
  const withCredential={...contract,credentials:{apiKey:'never store this'}};
  const result=validateFirmwareContract(withCredential,{expectedTarget:target,expectedSourceRevision:'eye-v2.2-review-1'});
  assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('credential-bearing field')));
});
