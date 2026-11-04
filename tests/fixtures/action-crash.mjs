import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ActionGate} from '../../server/actions.mjs';
import {FixtureAdapter} from '../../server/adapters/fixture.mjs';
const [root,raw]=process.argv.slice(2),input=JSON.parse(raw),adapter=new FixtureAdapter();
const target={projectId:input.projectId,documentId:input.documentId,path:join(root,'fixture.txt'),epoch:input.documentId,manifestHash:'initial'};
adapter.execute=async()=>{await writeFile(join(root,'applied.txt'),input.args.value);process.kill(process.pid,'SIGKILL');};
const gate=new ActionGate({path:join(root,'actions.json'),resolveTarget:async()=>target,adapters:new Map([['fixture',adapter]])});
await gate.init();const action=await gate.prepare(input);await gate.decide(action.id,'once');await gate.execute(action.id);
