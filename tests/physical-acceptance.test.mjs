import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePhysicalAcceptance} from '../shared/physical-acceptance.mjs';
import pending from '../docs/benchline/physical/ESP32-S3-EYE-v2.2-acceptance.pending.json' with {type:'json'};

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
function complete(overrides={}){return {schemaVersion:1,status:'accepted',recordRevision:'BL13-record-1',target,
  unit:{serial:'TEST-UNIT-001',mainBoardMarking:'ESP32-S3-EYE-MB_V2.2',mainBoardRevision:'v2.2'},software:{firmwareRevision:'firmware-1',firmwareSha256:'a'.repeat(64),protocolRevision:'protocol-1'},
  authorization:{flashApproved:true,powerApproved:true,approvedBy:'synthetic owner'},power:{source:'current-limited bench supply',voltageV:5,maxCurrentMA:500},equipment:['multimeter','USB power meter'],operator:'synthetic operator',
  measurements:[{criterion:'safe power-up',value:'observed nominal',unit:'V',tolerance:'owner-approved',observedAt:'2026-09-11T00:00:00.000Z',evidence:'operator log'}],fit:{enclosureRevision:'enclosure-1',fitPass:true,connectorAccess:'observed clear',antennaThermalCheck:'observed clear'},failures:[],simulatedValuesPresent:false,...overrides};}

test('accepts a complete record while withholding hardware action authority',()=>{const result=validatePhysicalAcceptance(complete(),{expectedTarget:target,expectedFirmwareRevision:'firmware-1'});assert.equal(result.valid,true);assert.deepEqual(result.blockers,[]);assert.equal(result.hardwareActionAuthorized,false);assert.equal(result.acceptanceAuthorized,false);});
test('rejects the pending record and missing physical inputs',()=>{const result=validatePhysicalAcceptance(pending,{expectedTarget:target});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('unit')));assert.ok(result.blockers.some(b=>b.includes('authorization')));assert.ok(result.blockers.some(b=>b.includes('measurements')));});
test('rejects wrong target or firmware revision',()=>{const result=validatePhysicalAcceptance(complete({target:{...target,hardwareRevision:'v2.1'},unit:{...complete().unit,mainBoardRevision:'v2.1'}}),{expectedTarget:target,expectedFirmwareRevision:'firmware-2'});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('target.hardwareRevision')));assert.ok(result.blockers.some(b=>b.includes('expected firmware-2')));});
test('rejects simulated evidence, mismatched unit revision and unresolved failures',()=>{const result=validatePhysicalAcceptance(complete({unit:{...complete().unit,mainBoardRevision:'v2.1'},measurements:[{...complete().measurements[0],evidence:'simulated value'}],failures:['connector misalignment']}),{expectedTarget:target});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('unit board revision')));assert.ok(result.blockers.some(b=>b.includes('simulated')));assert.ok(result.blockers.some(b=>b.includes('failed acceptance')));});
