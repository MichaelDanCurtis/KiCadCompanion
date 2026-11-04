// Read-only comparison of native diagnostic exports; never parses/writes CAD files.
import assert from 'node:assert/strict';
import {digest} from '../../server/actions.mjs';

// Native footprint-container iteration can change after Undo. Identity, not
// enumeration order, associates each entry with its footprint. Model order
// inside an entry is preserved and remains part of the comparison.
export function orderedNativeModels(entries){
  assert.ok(Array.isArray(entries));
  const ids=new Set();
  for(const entry of entries){
    assert.equal(typeof entry.footprint,'string');assert.ok(Array.isArray(entry.models));
    assert.ok(!ids.has(entry.footprint),'Duplicate native model footprint');ids.add(entry.footprint);
  }
  return [...entries].sort((a,b)=>a.footprint.localeCompare(b.footprint));
}

export function parseDiagnosticBoard(text){
  assert.equal(typeof text,'string');assert.ok(Buffer.byteLength(text)<=1024*1024);
  let i=0;
  const space=()=>{while(i<text.length&&/\s/.test(text[i]))i++;};
  function item(depth){
    assert.ok(depth<=128,'Diagnostic nesting limit');space();
    if(text[i]==='('){i++;const out=[];space();
      while(i<text.length&&text[i]!==')'){out.push(item(depth+1));space();}
      assert.equal(text[i++],')','Unclosed diagnostic list');return out;}
    const start=i;
    if(text[i]==='"'){i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return text.slice(start,i);}
      throw Error('Unclosed diagnostic string');}
    while(i<text.length&&!/[\s()]/.test(text[i]))i++;
    assert.ok(i>start,'Expected diagnostic atom');return text.slice(start,i);
  }
  const root=item(0);space();assert.equal(i,text.length,'Trailing diagnostic data');
  assert.ok(Array.isArray(root));assert.equal(root[0],'kicad_pcb');return root;
}

export function diagnosticProjection(snapshot,footprintIds){
  assert.equal(snapshot.experimental,true);assert.equal(snapshot.source,'ipc');assert.equal(snapshot.approval_granted,false);
  assert.match(snapshot.revision,/^[a-f0-9]{64}$/);
  const inputs=structuredClone(snapshot.inputs);assert.equal(inputs.capture_version,1);
  assert.ok(inputs.editor.document_lifetime);assert.ok(Number.isSafeInteger(inputs.editor.edit_epoch));
  assert.ok(Number.isSafeInteger(inputs.timestamp));assert.ok(inputs.filename);assert.ok(inputs.board_id);
  assert.ok(inputs.design_settings&&typeof inputs.design_settings==='object');assert.ok('project' in inputs);
  const selected=new Set(footprintIds);assert.equal(selected.size,footprintIds.length);assert.ok(selected.size>0);
  const found=new Set(),all=new Set();
  inputs.board_content=parseDiagnosticBoard(inputs.board_content).map(node=>{
    if(!Array.isArray(node)||node[0]!=='footprint')return node;
    const uuids=node.filter(n=>Array.isArray(n)&&n[0]==='uuid');assert.equal(uuids.length,1);
    const id=JSON.parse(uuids[0][1]);assert.ok(!all.has(id),'Duplicate serialized footprint');all.add(id);
    if(!selected.has(id))return node;
    found.add(id);return node.filter(n=>!(Array.isArray(n)&&n[0]==='model'));
  });
  assert.deepEqual(found,selected,'All reviewed footprints must occur in serialized content');
  const nativeIds=new Set();
  inputs.native_models=orderedNativeModels(inputs.native_models.map(entry=>{
    assert.ok(!nativeIds.has(entry.footprint));nativeIds.add(entry.footprint);assert.ok(Array.isArray(entry.models));
    return selected.has(entry.footprint)?{...entry,models:[]}:entry;
  }));
  assert.deepEqual(nativeIds,all,'Exact native transforms must cover every serialized footprint');
  if('native_footprint_attributes' in inputs){
    assert.ok(Array.isArray(inputs.native_footprint_attributes));
    const attributeIds=new Set();
    for(const entry of inputs.native_footprint_attributes){
      assert.equal(typeof entry.footprint,'string');
      assert.ok(!attributeIds.has(entry.footprint),'Duplicate native footprint attributes');
      attributeIds.add(entry.footprint);
    }
    assert.deepEqual(attributeIds,all,'Native attributes must cover every serialized footprint');
    inputs.native_footprint_attributes.sort((a,b)=>a.footprint.localeCompare(b.footprint));
  }
  // Only these revision counters may change during a native edit. All other
  // settings, serialization, model lists and unknown future fields stay compared.
  delete inputs.timestamp;delete inputs.editor.edit_epoch;
  return {nativeInstance:snapshot.native_instance,inputs};
}

export function assertModelOnlyPreserved(before,after,footprintIds){
  const left=diagnosticProjection(before,footprintIds),right=diagnosticProjection(after,footprintIds);
  assert.deepEqual(right,left,'Native update changed non-target-model diagnostic state');
  assert.ok(after.inputs.editor.edit_epoch>=before.inputs.editor.edit_epoch);
  return {preserved:true,projectionDigest:digest(left),scope:'All exported non-target-model revision inputs; not unexported editor state'};
}
