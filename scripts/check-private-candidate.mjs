import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validatePrivatePreviewCandidate} from '../shared/private-preview-candidate.mjs';

const path=resolve(process.argv[2]||'docs/benchline/release/ESP32-S3-EYE-v2.2-private-preview.pending.json');
let raw;
try {raw=JSON.parse(await readFile(path,'utf8'));}
catch {console.error('Private candidate check could not read the requested record.');process.exitCode=1;}
if(raw){
  const result=validatePrivatePreviewCandidate(raw,{expectedTarget:{vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'}});
  if(!result.valid){console.error(result.blockers.join('\n'));process.exitCode=1;}
  else console.log('PASS: private candidate record is complete; install and publication remain separately unauthorized.');
}
