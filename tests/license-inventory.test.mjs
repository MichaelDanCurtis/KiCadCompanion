import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {collectNpm,verifyInventory,sha256,packageClassification,runtimeSurface} from '../scripts/license-inventory.mjs';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'benchline-license-test-'));
  const pkg={version:'1.0.0',resolved:'https://registry.npmjs.org/example/-/example-1.0.0.tgz',integrity:'sha512-fixture',license:'MIT'};
  const lock={lockfileVersion:3,packages:{'':{dependencies:{example:'1.0.0'}},'node_modules/example':pkg}};
  const policy={reviewedLockSha256:'',licenses:{MIT:{classification:'permissive-declared',obligations:'Retain notices',gate:'G-NPM'}}};
  await mkdir(join(root,'node_modules/example'),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{example:'1.0.0'}}));
  await writeFile(join(root,'package-lock.json'),JSON.stringify(lock));
  await writeFile(join(root,'node_modules/example/package.json'),JSON.stringify({name:'example',version:'1.0.0',license:'MIT'}));
  await writeFile(join(root,'node_modules/example/LICENSE'),'Copyright Fixture\nPermission notice');
  policy.reviewedLockSha256=sha256(await readFile(join(root,'package-lock.json')));
  const current=await collectNpm(root,policy);
  const input={current,baseline:current.sbom,notices:current.notices,policy,catalog:{gates:[],integrations:[],assets:[]},files:[],resources:[]};
  return {root,lock,policy,input};
}
test('inventory reconciles exact locked/installed versions and notice hashes',async()=>{
  const {input}=await fixture();assert.deepEqual(verifyInventory(input),[]);assert.equal(input.baseline.components[0].version,'1.0.0');
  assert.equal(input.baseline.legalClearance,false);
});
test('new dependency is rejected even when it declares a preferred license',async()=>{
  const {root,lock,policy,input}=await fixture();lock.packages['node_modules/new-package']={...lock.packages['node_modules/example'],version:'2.0.0'};
  await writeFile(join(root,'package-lock.json'),JSON.stringify(lock));const current=await collectNpm(root,policy);
  assert.ok(verifyInventory({...input,current}).some(p=>p.includes('explicitly reviewed baseline')));
  // Even regenerating the report cannot change the policy's reviewed lock digest.
  assert.ok(verifyInventory({...input,current,baseline:current.sbom,notices:current.notices}).length>0);
});
test('missing and tampered shipped license notices fail the check',async()=>{
  const {root,input,policy}=await fixture();const hash=Object.keys(input.notices)[0];
  assert.ok(verifyInventory({...input,notices:{}}).some(p=>p.includes('missing or changed notice')));
  assert.ok(verifyInventory({...input,notices:{[hash]:{text:'changed'}}}).some(p=>p.includes('missing or changed notice')));
  await rm(join(root,'node_modules/example/LICENSE'));
  assert.ok((await collectNpm(root,policy)).problems.some(p=>p.includes('missing required license')));
});
test('unknown assets and remote fonts are rejected independently of npm licenses',async()=>{
  const {input}=await fixture();const p=verifyInventory({...input,files:['src/vendor-part.step','docs/vendor-guide.pdf','public/new-font.woff2','src/main.jsx'],resources:['https://example.test/new-font.css']});
  assert.equal(p.filter(x=>x.includes('unclassified asset')).length,3);assert.ok(p.some(x=>x.includes('unclassified external resource')));
});
test('runtime scan catches git-ignored assets that a frontend build could ship',async()=>{
  const {root}=await fixture();execFileSync('git',['init','-q'],{cwd:root});await mkdir(join(root,'public'));
  await writeFile(join(root,'.gitignore'),'node_modules/\n*.bin\n');await writeFile(join(root,'public/vendor.bin'),'fixture');
  const surface=await runtimeSurface(root);assert.ok(surface.files.includes('public/vendor.bin'));
});
test('new copyleft and unknown expressions require individual review, not blanket approval',()=>{
  const policy={licenses:{MIT:{classification:'permissive-declared'}}};
  for(const license of ['AGPL-3.0','GPL-3.0','Custom','(MIT AND GPL-3.0)'])assert.equal(packageClassification(license,policy).classification,'unresolved');
});
test('installed version or license drift fails rather than trusting the lockfile alone',async()=>{
  const {root,policy}=await fixture();await writeFile(join(root,'node_modules/example/package.json'),JSON.stringify({version:'2.0.0',license:'GPL-3.0'}));
  const r=await collectNpm(root,policy);assert.equal(r.problems.length,2);
});
test('extraneous installed dependencies cannot silently enter the reviewed build',async()=>{
  const {root,policy}=await fixture();await mkdir(join(root,'node_modules/unlisted'));
  await writeFile(join(root,'node_modules/unlisted/package.json'),JSON.stringify({name:'unlisted',version:'1.0.0',license:'MIT'}));
  assert.ok((await collectNpm(root,policy)).problems.some(p=>p.includes('absent from the reviewed lockfile')));
});
test('catalog entries must identify unresolved versions, origins, obligations and release gate',async()=>{
  const {input}=await fixture();input.catalog.assets=[{id:'model'}];const problems=verifyInventory(input);
  assert.ok(problems.some(p=>p.includes('missing version')));assert.ok(problems.some(p=>p.includes('missing named decision')));
});
test('the actual audited snapshot passes inventory checks but refuses release clearance',()=>{
  const cwd=resolve('.');const audit=spawnSync(process.execPath,['scripts/license-inventory.mjs'],{cwd,encoding:'utf8'});
  assert.equal(audit.status,0,audit.stdout+audit.stderr);assert.match(audit.stdout,/NOT legal clearance/);
  const release=spawnSync(process.execPath,['scripts/license-inventory.mjs','--release'],{cwd,encoding:'utf8'});
  assert.equal(release.status,1);assert.match(release.stderr,/G-KONNECT: release blocked/);assert.match(release.stderr,/G-OWNER: release blocked/);
});
