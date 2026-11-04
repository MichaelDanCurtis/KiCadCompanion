import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIntegrationScenario} from '../shared/integration-scenario.mjs';
import pending from '../docs/benchline/integration/ESP32-S3-EYE-v2.2-scenario.pending.json' with {type:'json'};

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
function complete(overrides={}){return {schemaVersion:1,status:'approved',scenarioRevision:'BL12-scenario-1',target,
  baseline:{projectRevision:'project-1',boardRevision:'board-1',firmwareRevision:'firmware-1',mechanicalRevision:'mechanical-1',applicationRevision:'app-1',bomRevision:'bom-1'},
  change:{kind:'connector',fromRevision:'connector-1',toRevision:'connector-2',description:'move the approved USB opening'},
  thresholds:{electrical:{maxCurrentMA:500,supplyToleranceV:0.25},mechanical:{minClearanceMM:1,maxFitGapMM:2},software:{commandTimeoutMs:500,maxRecoveryMs:5000}},
  artifacts:['electronics','firmware','mechanical','application','bom'].map((kind)=>({kind,revision:`${kind}-1`,sha256:'a'.repeat(64)})),toolVersions:{kicad:'10.0.6',freecad:'0.21.2',node:'22.23.0'},
  recovery:{checkpoint:'after baseline observation',restartAt:'before approved change',manualEditHandling:'invalidate stale proposal'},acceptanceChecks:['all dependent tasks current'],unresolvedWarnings:['physical acceptance remains pending'],physicalValidationPending:true,...overrides};}

test('accepts a complete scenario while withholding execution authority',()=>{const result=validateIntegrationScenario(complete(),{expectedTarget:target,expectedScenarioRevision:'BL12-scenario-1'});assert.equal(result.valid,true);assert.deepEqual(result.blockers,[]);assert.equal(result.softwareAuthorized,false);assert.equal(result.executionAuthorized,false);});
test('rejects the pending scenario and missing frozen inputs',()=>{const result=validateIntegrationScenario(pending,{expectedTarget:target});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('baseline')));assert.ok(result.blockers.some(b=>b.includes('thresholds')));assert.ok(result.blockers.some(b=>b.includes('artifacts')));});
test('rejects wrong target and stale scenario revision',()=>{const result=validateIntegrationScenario(complete({target:{...target,hardwareRevision:'v2.1'}}),{expectedTarget:target,expectedScenarioRevision:'BL12-scenario-2'});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('target.hardwareRevision')));assert.ok(result.blockers.some(b=>b.includes('stale scenario')));});
test('rejects incomplete artifact sets, unchanged revisions and unsafe thresholds',()=>{const base=complete();const result=validateIntegrationScenario({...base,change:{...base.change,toRevision:base.change.fromRevision},thresholds:{...base.thresholds,mechanical:{minClearanceMM:3,maxFitGapMM:1}},artifacts:base.artifacts.slice(0,4)},{expectedTarget:target});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('advance')));assert.ok(result.blockers.some(b=>b.includes('maximum fit gap')));assert.ok(result.blockers.some(b=>b.includes('artifacts')));});

