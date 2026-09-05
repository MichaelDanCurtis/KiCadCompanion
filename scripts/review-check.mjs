// Audits exactly the tracked/staged export surface, not ignored private runtime data.
import {execFileSync} from 'node:child_process';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw new Error('No tracked files. Stage the intended review source first.');
const problems=[];
for(const file of files){
  if(/(^|\/)(node_modules|dist|\.runtime|\.review|\.git|__pycache__)(\/|$)|\.(png|jpe?g|webp|pem|key|log|pyc)$|\.kicad_|(^|\/)(fp-lib-table|sym-lib-table)$|(^|\/)\.env(?!\.example$)/i.test(file))problems.push(`${file}: private or generated file type`);
  const text=execFileSync('git',['show',`:${file}`],{encoding:'utf8',maxBuffer:4e6});
  if(/\/(?:Users|Volumes)\/[A-Za-z0-9]/.test(text))problems.push(`${file}: machine-specific absolute path`);
  if(/\bsk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))problems.push(`${file}: possible credential`);
  if(new RegExp(['system','bus'].join(''),'i').test(text))problems.push(`${file}: prototype-specific identity`);
}
if(problems.length)throw new Error(problems.join('\n'));
console.log(`PASS: ${files.length} tracked files; no forbidden artifacts, personal paths or obvious credential patterns. Manual review still required.`);
