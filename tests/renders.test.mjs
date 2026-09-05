import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderOptions,viewerConfig,pngBytes,RenderStore} from '../server/renders.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
test('render options accept only bounded presets, never arbitrary CLI input',()=>{
  assert.equal(renderOptions.parse({}).camera,'perspective');
  for(const bad of [{camera:'--help'},{width:100000},{color:'url(x)'},{board:'/etc/passwd'}])assert.throws(()=>renderOptions.parse(bad));
  for(const color of ['white','black','green','red','kicad']){
    const config=viewerConfig(color);assert.equal(config.layer_presets[0].name,'companion-render');
    assert.ok(config.layer_presets[0].layers.includes('smd_models'));
    assert.ok(!config.layer_presets[0].layers.includes('dnp_models'));
  }
});
test('image ingestion rejects paths, remote URLs and non-PNG payloads',()=>{
  assert.ok(pngBytes(png).length>8);
  for(const input of ['/etc/passwd','https://example.com/a.png','PHN2Zz48L3N2Zz4=',null])assert.throws(()=>pngBytes(input));
});
test('render jobs preserve board provenance, reject overlap, persist history and fail on changed source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'companion-render-test-'));
  const board=join(root,'fixture.txt');await writeFile(board,'saved board fixture');
  const store=new RenderStore({root:join(root,'renders'),appRoot:root});await store.init();
  let release;store.run=async(binary,args)=>{
    if(args.includes('pcb')){await new Promise(r=>{release=r});await writeFile(args[args.indexOf('-o')+1],Buffer.from(png,'base64'));return 'rendered';}
    return '{"components":[]}';
  };
  const job=await store.start(board,{color:'red'});
  await assert.rejects(()=>store.start(board,{}),/already running/);
  while(!release)await new Promise(r=>setTimeout(r,5));
  release();while(store.pending)await new Promise(r=>setTimeout(r,5));
  assert.equal(job.status,'completed');assert.equal(job.source.sha256.length,64);
  assert.throws(()=>store.path('../fixture','actual'),/Unknown render/);
  assert.throws(()=>store.path(job.id,'../fixture'),/Unknown image kind/);
  job.ai={status:'running'};await store.save(job);
  const restored=new RenderStore({root:store.root,appRoot:root});await restored.init();
  assert.equal(restored.list(board)[0].ai.status,'failed');
  await store.receiveAI(job.id,{result:png,revisedPrompt:'test'});
  assert.equal(JSON.parse(await readFile(join(store.root,job.id,'manifest.json'))).ai.status,'completed');
  release=null;const changed=await store.start(board,{});
  while(!release)await new Promise(r=>setTimeout(r,5));
  await writeFile(board,'new saved fixture');release();while(store.pending)await new Promise(r=>setTimeout(r,5));
  assert.equal(changed.status,'failed');assert.match(changed.error,/changed during rendering/);
});
