import {readFile,readdir} from 'node:fs/promises';
import {relative,resolve,join} from 'node:path';
import {inspectFirmwareArtifacts} from '../shared/firmware-contract.mjs';

const root=resolve(process.argv[2]||'.');
const entries=await readdir(root,{recursive:true,withFileTypes:true});
const artifacts=[];
for(const entry of entries) {
  if(!entry.isFile())continue;
  const path=relative(root,join(entry.parentPath||root,entry.name));
  if(path.split('/').some(part=>['.git','node_modules'].includes(part)))continue;
  try {artifacts.push({path,content:await readFile(join(root,path),'utf8')});}
  catch {artifacts.push({path,content:''});}
}
const result=inspectFirmwareArtifacts(artifacts);
if(!result.clean){console.error(result.blockers.join('\n'));process.exitCode=1;}
else console.log(`PASS: ${result.artifactCount} firmware artifact files contain no obvious credentials or machine-specific paths.`);
