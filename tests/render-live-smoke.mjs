// Read-only board rendering integration test. Creates local render artifacts; never saves KiCad sources.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.COMPANION_URL;
if(!base)throw new Error('Set COMPANION_URL explicitly; this test creates local render artifacts');
const state=await(await fetch(`${base}/api/state`)).json();
const hash=async()=>createHash('sha256').update(await readFile(state.board)).digest('hex');
const before=await hash();
for(const [color,camera] of [['white','top'],['black','bottom'],['red','perspective'],['kicad','top']]){
  const response=await fetch(`${base}/api/renders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({color,camera})});
  assert.equal(response.status,200);let job=await response.json();
  const deadline=Date.now()+180000;
  while(['queued','running'].includes(job.status)&&Date.now()<deadline){
    await new Promise(r=>setTimeout(r,700));
    job=(await(await fetch(`${base}/api/renders`)).json()).find(j=>j.id===job.id);
  }
  assert.equal(job.status,'completed',job.error);
  const image=await fetch(`${base}/api/renders/${job.id}/actual.png`);
  assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);
  const bytes=Buffer.from(await image.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  console.log(JSON.stringify({color,camera,id:job.id,bytes:bytes.length}));
}
assert.equal(await hash(),before,'KiCad source must not change');
assert.equal((await fetch(`${base}/api/renders/not-a-job/actual.png`)).status,400);
assert.equal((await fetch(`${base}/api/renders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({camera:'--help'})})).status,400);
console.log('Render HTTP smoke passed; board SHA-256 unchanged.');
