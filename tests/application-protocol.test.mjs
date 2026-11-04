import test from 'node:test';
import assert from 'node:assert/strict';
import {validateApplicationProtocol} from '../shared/application-protocol.mjs';
import pending from '../docs/benchline/application/ESP32-S3-EYE-v2.2-protocol.pending.json' with {type:'json'};

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
function complete(overrides={}){return {schemaVersion:1,status:'approved',contractRevision:'BL11-protocol-1',sourceRevision:'eye-v2.2-protocol-1',target,
  applicationNeeded:'test-only local control panel',referenceInteraction:'send ping and show the response',transport:'loopback WebSocket',version:'1.0.0',
  commands:[{name:'ping',request:'PING',response:'PONG'}],responses:['PONG'],errorSemantics:{invalidPayload:'show rejected payload',timeout:'show timeout',disconnect:'show disconnected',incompatibleVersion:'show version error'},timeoutMs:500,...overrides};}

test('accepts one complete protocol while withholding browser and simulator authority',()=>{const result=validateApplicationProtocol(complete(),{expectedTarget:target,expectedSourceRevision:'eye-v2.2-protocol-1'});assert.equal(result.valid,true);assert.deepEqual(result.blockers,[]);assert.equal(result.browserAuthorized,false);assert.equal(result.simulatorAuthorized,false);});
test('rejects the pending protocol and missing application decisions',()=>{const result=validateApplicationProtocol(pending,{expectedTarget:target});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('applicationNeeded')));assert.ok(result.blockers.some(b=>b.includes('commands')));assert.ok(result.blockers.some(b=>b.includes('version')));});
test('rejects wrong target and stale source revision',()=>{const result=validateApplicationProtocol(complete({target:{...target,hardwareRevision:'v2.1'}}),{expectedTarget:target,expectedSourceRevision:'eye-v2.2-protocol-2'});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('target.hardwareRevision')));assert.ok(result.blockers.some(b=>b.includes('stale contract')));});
test('rejects duplicate commands and undeclared responses',()=>{const base=complete();const result=validateApplicationProtocol({...base,commands:[base.commands[0],{name:'ping',request:'PING2',response:'OTHER'}]}, {expectedTarget:target,expectedSourceRevision:base.sourceRevision});assert.equal(result.valid,false);assert.ok(result.blockers.some(b=>b.includes('command names')));assert.ok(result.blockers.some(b=>b.includes('missing declared response')));});

