import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCoverage} from '../shared/model-coverage.mjs';
const model=(extra={})=>({exists:true,visible:true,opacity:1,...extra});
const part=(reference,models,dnp=false)=>({reference,models,dnp});
test('coverage separates DNP, empty, hidden, transparent, missing and partially available models',()=>{
  const report={schemaVersion:2,components:[part('U1',[model()]),part('R1',[model()],true),part('J1',[]),
    part('U2',[model({visible:false})]),part('U3',[model({exists:false})]),part('U4',[model({opacity:0})]),
    part('J2',[model(),model({exists:false})]),part('D1',[model({exists:false})],true)]};
  const summary=modelCoverage(report),refs=rows=>rows.map(c=>c.reference);
  assert.deepEqual(refs(summary.available),['U1','J2']);
  assert.deepEqual(refs(summary.omitted),['R1','D1']);
  assert.deepEqual(refs(summary.missing),['J1','U2','U3','U4']);
  assert.deepEqual(refs(summary.partial),['J2']);
  assert.equal(summary.populated.length,6);
});
test('old snapshots and malformed coverage cannot imply population or visible geometry',()=>{
  for(const report of [null,{schemaVersion:2,components:[null]},{schemaVersion:2,components:[part('U1',[null])]},{components:[part('U1',[model()])]},{schemaVersion:2,components:[{reference:'U1',models:[model()]}]},
    {schemaVersion:2,components:[part('U1',[model({opacity:null})])]}])assert.equal(modelCoverage(report),null);
  assert.deepEqual(modelCoverage({schemaVersion:2,components:[]}).available,[]);
});
