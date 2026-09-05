// Explicit integration test against the local companion. Reads data and changes selection only.
import assert from 'node:assert/strict';
const base=process.env.COMPANION_URL;
if(!base)throw new Error('Set COMPANION_URL explicitly; this test changes selection and adds a visual');
const original=await (await fetch(base+'/api/state')).json();
assert.equal(original.status,'live');
assert.ok(original.live.components.length>0);
const reference=original.live.components.find(c=>c.reference==='U1')?.reference||original.live.components[0].reference;
const post=async(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const selected=await (await post('/api/select',{reference})).json();
assert.ok(selected.selected.includes(reference));
const denied=await fetch(base+'/api/open',{method:'POST',headers:{Origin:'https://untrusted.example'}});
assert.equal(denied.status,403);
const internal=await post('/internal/visual',{id:'bad'});assert.equal(internal.status,403);
const unknown=await post('/api/project',{path:'/tmp/unrelated.kicad_pcb'});assert.ok([400,409].includes(unknown.status));
const chart=await (await post('/api/visualize-board',{})).json();assert.equal(chart.surfaceId,'board-inventory');
console.log('PASS: live IPC, selection, A2UI surface, origin rejection, internal auth, project boundary');
