// Read installed metadata only. Never downloads packages, executes their scripts,
// accepts terms, or changes a reviewed policy. --write refreshes generated reports.
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join,relative,extname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

export const sha256=value=>createHash('sha256').update(value).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const stable=value=>JSON.stringify(value);
const noticeName=name=>/(?:^|[._-])(licen[cs]e|notice|copying|copyright)(?:[._-]|$)/i.test(name);
const sourceExtensions=new Set(['.mjs','.js','.jsx','.ts','.tsx','.py','.swift','.css','.html','.plist','.json','.md','.mdx','.yml','.yaml','.toml','.txt']);

export function packageClassification(license,policy) {
  return policy.licenses[license]||{classification:'unresolved',obligations:'Review exact license and all embedded third-party terms before shipping.',gate:'G-NPM'};
}
export function unclassifiedAssets(files,catalog) {
  const known=new Set(catalog.assets.flatMap(a=>a.paths||[]));
  return files.filter(p=>!p.startsWith('docs/benchline/licenses/')&&!known.has(p)&&
    (p.startsWith('public/')||/\.(?:kicad_\w+|step|stp|stl|3mf|wrl|obj|glb|gltf|png|jpe?g|webp|gif|svg|ico|icns|pdf|woff2?|ttf|otf|bin|wasm|dylib|so|dll|exe|zip|gz|tar)$/i.test(p)||(!sourceExtensions.has(extname(p))&&!['.gitignore','.env.example','THIRD_PARTY.md'].includes(basename(p))&&extname(p)!=='')));
}
async function licensesIn(directory,depth=0) {
  const paths=[];
  for(const e of await readdir(directory,{withFileTypes:true})){
    if(e.name==='node_modules'||e.name==='.git')continue;
    if(e.isFile()&&noticeName(e.name))paths.push(join(directory,e.name));
    else if(e.isDirectory()&&depth<5)paths.push(...await licensesIn(join(directory,e.name),depth+1));
  }
  return paths.sort();
}
async function installedPackagePaths(root,directory=join(root,'node_modules')) {
  const found=[];
  async function entry(path){
    try{await readFile(join(path,'package.json'));found.push(relative(root,path));found.push(...await installedPackagePaths(root,join(path,'node_modules')));}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  try{for(const e of await readdir(directory,{withFileTypes:true})){
    if(e.name.startsWith('.'))continue;
    const path=join(directory,e.name);
    if(e.isSymbolicLink())throw new Error(`Unreviewed installed package symlink: ${relative(root,path)}`);
    if(!e.isDirectory())continue;
    if(e.name.startsWith('@')){for(const nested of await readdir(path,{withFileTypes:true})){
      if(nested.isSymbolicLink())throw new Error(`Unreviewed scoped package symlink: ${e.name}/${nested.name}`);
      if(nested.isDirectory())await entry(join(path,nested.name));
    }}else await entry(path);
  }}catch(e){if(e.code!=='ENOENT')throw e;}
  return found;
}
export async function collectNpm(root,policy) {
  const raw=await readFile(join(root,'package-lock.json')),
    lock=JSON.parse(raw),manifest=await json(join(root,'package.json'));
  if(lock.lockfileVersion!==3)throw new Error('Only npm lockfile version 3 is audited by this checker.');
  const notices={},components=[],problems=[];
  for(const [path,pkg] of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b))){
    if(!path)continue;
    if(!path.startsWith('node_modules/')||path.split('/').includes('..')||pkg.link)throw new Error(`Unsupported dependency path: ${path}`);
    const component={id:path,name:pkg.name||path.split('node_modules/').at(-1),version:pkg.version,
      source:pkg.resolved||'UNRESOLVED',integrity:pkg.integrity||'UNRESOLVED',declaredLicense:pkg.license||'UNRESOLVED',
      mode:pkg.dev?'build-only; not intended to ship':'conservative shipped runtime closure',optional:!!pkg.optional,
      platforms:{os:pkg.os||[],cpu:pkg.cpu||[],libc:pkg.libc||[]},
      dependencies:pkg.dependencies||{},optionalDependencies:pkg.optionalDependencies||{},peerDependencies:pkg.peerDependencies||{},
      review:packageClassification(pkg.license,policy),notices:[],installed:false};
    const directory=join(root,path);
    try{
      const actual=await json(join(directory,'package.json'));component.installed=true;
      if(actual.version!==pkg.version)problems.push(`${path}: installed version differs from lockfile`);
      if(actual.license&&typeof actual.license==='string'&&actual.license!==pkg.license)problems.push(`${path}: installed license differs from lockfile`);
      component.upstream=actual.repository||actual.homepage||null;
      for(const file of await licensesIn(directory)){
        const text=await readFile(file,'utf8'),hash=sha256(text),source=relative(root,file);
        notices[hash]??={text,sources:[]};notices[hash].sources.push(source);
        component.notices.push({source,sha256:hash});
      }
      if(!component.notices.length){
        const gap=policy.noticeGaps?.[`${path}@${pkg.version}`];
        if(pkg.dev&&gap)component.review={classification:'unresolved-native-notices',obligations:gap,gate:'G-TARGET'};
        else problems.push(`${path}: missing required license/notice evidence`);
      }
    }catch(e){if(e.code!=='ENOENT')throw e;if(!pkg.dev||!pkg.optional)problems.push(`${path}: required package missing; install the reviewed lockfile first`);}
    if(!component.installed)component.review={classification:'unresolved-platform-optional',obligations:'Not installed on this host. Collect exact binary notices on every target build before redistribution.',gate:'G-TARGET'};
    components.push(component);
  }
  for(const kind of ['dependencies','devDependencies','optionalDependencies'])if(stable(manifest[kind]||{})!==stable(lock.packages[''][kind]||{}))problems.push(`${kind}: package manifest and lockfile differ`);
  for(const path of await installedPackagePaths(root))if(!lock.packages[path])problems.push(`${path}: installed dependency is absent from the reviewed lockfile`);
  return {sbom:{schemaVersion:1,format:'benchline-component-inventory',legalClearance:false,
    scope:'All npm lock entries; runtime closure conservatively treated as shipped, not a tree-shaken artifact claim.',
    lockSha256:sha256(raw),components},notices,problems};
}
export function verifyInventory({current,baseline,notices,policy,catalog,files,resources}) {
  const problems=[...current.problems];
  if(policy.reviewedLockSha256!==current.sbom.lockSha256)problems.push('Lockfile differs from the explicitly reviewed baseline; regeneration cannot approve it.');
  if(stable(current.sbom)!==stable(baseline))problems.push('Dependency inventory is stale or changed; review the diff and refresh the report.');
  for(const c of baseline.components){
    if(!c.review?.classification||!c.review.obligations)problems.push(`${c.id}: unclassified dependency`);
    if(c.review?.classification==='unresolved')problems.push(`${c.id}: unreviewed license`);
    for(const n of c.notices||[]){if(!notices[n.sha256]||sha256(notices[n.sha256].text)!==n.sha256)problems.push(`${c.id}: missing or changed notice ${n.source}`);}
  }
  for(const p of unclassifiedAssets(files,catalog))problems.push(`${p}: unclassified asset; record its origin and redistribution decision`);
  for(const r of resources)if(!catalog.assets.some(a=>a.resource===r))problems.push(`${r}: unclassified external resource`);
  const gateIds=new Set(catalog.gates.map(g=>g.id));
  for(const item of [...catalog.integrations,...catalog.assets]){
    for(const key of ['id','version','source','declaredLicense','mode','obligations','gate'])if(!item[key])problems.push(`${item.id||'catalog entry'}: missing ${key}`);
    if(!gateIds.has(item.gate))problems.push(`${item.id}: missing named decision/release gate`);
  }
  return problems;
}
export async function runtimeSurface(root) {
  const files=[...new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))].sort();
  // Git-ignored local assets can still enter the browser build. Inspect runtime
  // source/public directories too, without reading protected design contents.
  async function scan(directory){try{for(const e of await readdir(directory,{withFileTypes:true})){const p=join(directory,e.name);if(e.isSymbolicLink())throw new Error(`Unreviewed runtime symlink: ${relative(root,p)}`);if(e.isDirectory())await scan(p);else if(e.isFile())files.push(relative(root,p));}}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const name of ['src','public','native','server','shared'])await scan(join(root,name));
  const resources=[];
  for(const p of files.filter(p=>p.startsWith('src/')&&extname(p)==='.css')){
    const css=await readFile(join(root,p),'utf8');for(const match of css.matchAll(/(?:@import\s+url\(|url\()\s*['"]?(https?:[^'"\s)]+)/g))resources.push(match[1]);
  }
  return {files:[...new Set(files)].sort(),resources:[...new Set(resources)].sort()};
}
async function main(){
  const root=resolve(fileURLToPath(new URL('..',import.meta.url))),directory=join(root,'docs/benchline/licenses');
  const policy=await json(join(directory,'policy.json')),catalog=await json(join(directory,'catalog.json'));
  const current=await collectNpm(root,policy),surface=await runtimeSurface(root);
  if(process.argv.includes('--write')){
    if(current.problems.length)throw new Error(current.problems.join('\n'));
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'npm-sbom.json'),JSON.stringify(current.sbom,null,2)+'\n');
    await writeFile(join(directory,'npm-notices.json'),JSON.stringify(current.notices,null,2)+'\n');
    console.log('Generated inventory and notice evidence. No review policy, license choice or release gate was changed.');
  }
  if(process.argv.includes('--python-snapshot')){
    const executable=join(root,'.runtime/venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    const snapshot=JSON.parse(execFileSync(executable,[join(root,'scripts/python-license-inventory.py')],{encoding:'utf8',maxBuffer:8e6}));
    await writeFile(join(directory,'python-sbom.json'),JSON.stringify(snapshot,null,2)+'\n');
    console.log(`Recorded ${snapshot.components.length} observer Python distributions; native binary and interpreter redistribution remain unresolved.`);
  }
  const baseline=await json(join(directory,'npm-sbom.json')),notices=await json(join(directory,'npm-notices.json'));
  const problems=verifyInventory({current,baseline,notices,policy,catalog,...surface});
  const open=catalog.gates.filter(g=>g.status!=='resolved');
  if(process.argv.includes('--release'))for(const gate of open)problems.push(`${gate.id}: release blocked — ${gate.decision}`);
  if(problems.length)throw new Error(problems.join('\n'));
  console.log(`PASS: ${baseline.components.length} npm entries reconciled; ${Object.keys(notices).length} notice texts verified. ${open.length} explicit release gates remain open. NOT legal clearance.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
