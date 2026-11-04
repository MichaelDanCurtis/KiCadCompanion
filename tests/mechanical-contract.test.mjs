import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMechanicalContract} from '../shared/mechanical-contract.mjs';
import pending from '../docs/benchline/mechanical/ESP32-S3-EYE-v2.2-contract.pending.json' with {type:'json'};

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
function complete(overrides={}){return {schemaVersion:1,status:'approved',contractRevision:'BL10-contract-1',sourceRevision:'eye-v2.2-mechanical-1',target,
  units:'mm',boardOutline:{widthMM:30,lengthMM:60},assemblyEnvelope:{widthMM:40,lengthMM:70,heightMM:25},origin:{xMM:0,yMM:0,zMM:0},orientation:{up:'top',rotationDeg:0},
  mountHoles:[{id:'H1',xMM:3,yMM:3,diameterMM:2.5},{id:'H2',xMM:27,yMM:3,diameterMM:2.5}],connectorOpenings:[{id:'USB',xMM:20,yMM:0,widthMM:8,heightMM:4,side:'front'}],
  antennaAndThermalClearances:{antennaMM:5,thermalMM:3},material:'test-only PLA',printTolerances:{xyMM:0.2,zMM:0.2},freecadVersion:'0.21.2',sourceRevisionConflicts:[],...overrides};}

test('accepts a complete synthetic contract without authorizing FreeCAD writes',()=>{const result=validateMechanicalContract(complete(),{expectedTarget:target,expectedSourceRevision:'eye-v2.2-mechanical-1'});assert.equal(result.valid,true);assert.deepEqual(result.blockers,[]);assert.equal(result.freecadAuthorized,false);assert.equal(result.writeAuthorized,false);});
test('rejects the pending contract and unresolved envelope inputs',()=>{const result=validateMechanicalContract(pending,{expectedTarget:target});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('assemblyEnvelope')));assert.ok(result.blockers.some(b=>b.includes('mountHoles')));assert.ok(result.blockers.some(b=>b.includes('freecadVersion')));});
test('rejects wrong target and stale source revision',()=>{const result=validateMechanicalContract(complete({target:{...target,hardwareRevision:'v2.1'}}),{expectedTarget:target,expectedSourceRevision:'eye-v2.2-mechanical-2'});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('target.hardwareRevision')));assert.ok(result.blockers.some(b=>b.includes('stale contract')));});
test('rejects undersized envelope, duplicate holes and source conflicts',()=>{const base=complete();const result=validateMechanicalContract({...base,assemblyEnvelope:{...base.assemblyEnvelope,widthMM:20},mountHoles:[base.mountHoles[0],base.mountHoles[0]],sourceRevisionConflicts:['sub-board revision mismatch']},{expectedTarget:target,expectedSourceRevision:base.sourceRevision});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('smaller than board outline')));assert.ok(result.blockers.some(b=>b.includes('mount-hole IDs')));assert.ok(result.blockers.some(b=>b.includes('source revision conflicts')));});
