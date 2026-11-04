import test from 'node:test';
import assert from 'node:assert/strict';
import {assertModelOnlyPreserved,parseDiagnosticBoard} from './fixtures/native-diagnostic-compare.mjs';

const snapshot=()=>({experimental:true,source:'ipc',approval_granted:false,native_instance:'fixture-native',revision:'a'.repeat(64),inputs:{
  capture_version:1,board_id:'board',filename:'/disposable',timestamp:1,selected_variant:'First',editor:{document_lifetime:'lifetime',edit_epoch:1},
  board_content:'(kicad_pcb (footprint "part" (uuid "one") (property "Custom" "keep") (model "old")) (footprint "other" (uuid "two") (model "other")) (segment (start 1 2) (end 3 4)))',
  design_settings:{clearance:0.2},project:{settings:{rules:['keep']}},
  net_settings:{clearance:0.2},net_settings_linked_to_project:true,
  native_polygons:[{id:'polygon',footprint:'one',outlines:[[{closed:true,points:[[1,2],[3,4],[5,6]],arcs:[],arc_membership:[]}]]}],
  native_placements:[{id:'pad',footprint:'one',position:[1,2],angle_deg:37.123456789}],
  native_shapes:[{id:'curve',footprint:'one',start:[1,2],end:[3,4],control1:[4,5],control2:[6,7]}],
  dynamic_component_rules:[{class:'ASSIGNED',condition:"A.Reference == 'U1'"}],
  native_models:[{footprint:'one',models:[{filename:'old',opacity:0.123456789}]},{footprint:'two',models:[{filename:'other'}]}],
}});
test('diagnostic projection permits only selected model lists and explicit revision counters',()=>{
  const before=snapshot(),after=structuredClone(before);after.revision='b'.repeat(64);after.inputs.timestamp++;after.inputs.editor.edit_epoch++;
  after.inputs.board_content=after.inputs.board_content.replace('(model "old")','(model "new" (opacity 0.9))');
  after.inputs.native_models[0].models=[{filename:'new',opacity:0.9}];
  assert.equal(assertModelOnlyPreserved(before,after,['one']).preserved,true);
  for(const mutate of [s=>s.inputs.design_settings.clearance=0.3,s=>s.inputs.project.settings.rules=[],
    s=>s.inputs.net_settings.clearance=0.3,s=>s.inputs.net_settings_linked_to_project=false,
    s=>s.inputs.native_polygons[0].outlines[0][0].points[0][0]++,
    s=>s.inputs.native_placements[0].angle_deg+=0.000000001,
    s=>s.inputs.native_shapes[0].control1[0]++,
    s=>s.inputs.board_content=s.inputs.board_content.replace('"keep"','"lost"'),
    s=>s.inputs.board_content=s.inputs.board_content.replace('(end 3 4)','(end 3 5)'),
    s=>s.inputs.native_models[1].models[0].filename='changed',s=>s.inputs.editor.document_lifetime='reopened',
    s=>s.inputs.dynamic_component_rules[0].condition="A.Reference == 'U2'",
    s=>s.native_instance='other',s=>s.inputs.filename='/other',s=>s.inputs.selected_variant='Second',s=>s.inputs.new_unexpected_field='changed']){
    const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertModelOnlyPreserved(before,changed,['one']));
  }
});
test('diagnostic comparison refuses missing/duplicate targets and malformed export trees',()=>{
  const before=snapshot();
  for(const ids of [['absent'],['one','one']])assert.throws(()=>assertModelOnlyPreserved(before,before,ids));
  for(const text of ['(kicad_pcb','(kicad_pcb) trailing','(kicad_pcb "unfinished)','(wrong)', '('.repeat(130)+')'.repeat(130)])assert.throws(()=>parseDiagnosticBoard(text));
  const missing=structuredClone(before);missing.inputs.native_models.pop();
  assert.throws(()=>assertModelOnlyPreserved(before,missing,['one']));
  const duplicate=structuredClone(before);duplicate.inputs.board_content=duplicate.inputs.board_content.replace('(uuid "two")','(uuid "one")');
  assert.throws(()=>assertModelOnlyPreserved(before,duplicate,['one']));
  const unsafe=structuredClone(before);unsafe.inputs.editor.edit_epoch=Number.MAX_SAFE_INTEGER+1;
  assert.throws(()=>assertModelOnlyPreserved(before,unsafe,['one']));
});
test('native footprint entry order is immaterial but model order and identities remain protected',()=>{
  const before=snapshot();
  before.inputs.native_models[1].models.push({filename:'second',opacity:0.5});
  before.inputs.board_content=before.inputs.board_content.replace('(model "other")','(model "other") (model "second")');
  const reordered=structuredClone(before);reordered.inputs.native_models.reverse();
  assert.equal(assertModelOnlyPreserved(before,reordered,['one']).preserved,true);
  const changed=structuredClone(reordered);changed.inputs.native_models[0].models.reverse();
  assert.throws(()=>assertModelOnlyPreserved(before,changed,['one']));
  const duplicate=structuredClone(reordered);duplicate.inputs.native_models[1]=structuredClone(duplicate.inputs.native_models[0]);
  assert.throws(()=>assertModelOnlyPreserved(before,duplicate,['one']));
});

test('native undo may reorder attribute records but must preserve every footprint attribute',()=>{
  const before=snapshot();
  before.inputs.native_footprint_attributes=[{footprint:'one',attributes:0},{footprint:'two',attributes:8}];
  const reordered=structuredClone(before);reordered.inputs.native_footprint_attributes.reverse();
  assert.equal(assertModelOnlyPreserved(before,reordered,['one']).preserved,true);
  for(const mutate of [s=>s.inputs.native_footprint_attributes[0].attributes=0,
    s=>s.inputs.native_footprint_attributes[1].attributes=8,
    s=>s.inputs.native_footprint_attributes[1].footprint='two',
    s=>s.inputs.native_footprint_attributes.pop(),
    s=>delete s.inputs.native_footprint_attributes]){
    const changed=structuredClone(reordered);mutate(changed);
    assert.throws(()=>assertModelOnlyPreserved(before,changed,['one']));
  }
});
