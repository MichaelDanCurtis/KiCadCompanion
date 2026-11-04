// Disposable text-only crash probe. Never register this adapter in production.
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {WorkflowStore} from '../../server/workflows.mjs';
const [root,boundary]=process.argv.slice(2);
const plan=JSON.parse(await readFile(join(root,'plan.json'),'utf8'));
const crash=()=>process.kill(process.pid,'SIGKILL');
const adapter={mutating:true,authorize:async()=>{if(boundary==='approved')crash();},execute:async()=>{
  if(boundary==='executing')crash();
  await appendFile(join(root,'writes.txt'),'one write\n');
  if(boundary==='post-write')crash();
  return {locator:'writes.txt',revision:'written-once'};
},verify:async()=>{if(boundary==='verifying')crash();return [];}};
const store=new WorkflowStore({path:join(root,'workflows.sqlite'),adapters:new Map([['fixture',adapter]]),observeInputs:async()=>({source:'revision-1'})});
store.create(plan,'create');
if(boundary==='proposed')crash();
store.activate(plan.id,'activate');
await store.run(plan.tasks[0].id,{requestId:'run',approvalRef:'disposable-action-reference'});
await store.close();
await writeFile(join(root,'unexpected-completion.txt'),'Crash boundary was not reached');
