import {z} from 'zod';

const nonEmpty=z.string().trim().min(1).max(1000);
const targetSchema=z.object({vendor:nonEmpty,model:nonEmpty,hardwareRevision:nonEmpty}).strict();
const commandSchema=z.object({name:nonEmpty,request:nonEmpty,response:nonEmpty}).strict();
const errorsSchema=z.object({invalidPayload:nonEmpty,timeout:nonEmpty,disconnect:nonEmpty,incompatibleVersion:nonEmpty}).strict();

export const applicationProtocolSchema=z.object({
  schemaVersion:z.literal(1),status:z.literal('approved'),contractRevision:nonEmpty,sourceRevision:nonEmpty,target:targetSchema,
  applicationNeeded:nonEmpty,referenceInteraction:nonEmpty,transport:nonEmpty,version:nonEmpty,
  commands:z.array(commandSchema).min(1).max(100),responses:z.array(nonEmpty).min(1).max(100),errorSemantics:errorsSchema,
  timeoutMs:z.number().int().positive(),
}).strict().superRefine((protocol,ctx)=>{
  if(new Set(protocol.commands.map(c=>c.name)).size!==protocol.commands.length)
    ctx.addIssue({code:'custom',path:['commands'],message:'command names must be unique'});
  const responseNames=new Set(protocol.responses);
  for(const command of protocol.commands)if(!responseNames.has(command.response))
    ctx.addIssue({code:'custom',path:['responses'],message:`missing declared response ${command.response}`});
});

function formatIssues(error){return error.issues.map(issue=>`${issue.path.join('.')||'protocol'}: ${issue.message}`);}

export function validateApplicationProtocol(raw,{expectedTarget,expectedSourceRevision}={}) {
  const blockers=[],parsed=applicationProtocolSchema.safeParse(raw);
  if(!parsed.success)blockers.push(...formatIssues(parsed.error));
  if(parsed.success&&expectedTarget)for(const key of ['vendor','model','hardwareRevision'])
    if(parsed.data.target[key]!==expectedTarget[key])blockers.push(`target.${key}: expected ${expectedTarget[key]}, got ${parsed.data.target[key]}`);
  if(parsed.success&&expectedSourceRevision&&parsed.data.sourceRevision!==expectedSourceRevision)
    blockers.push(`sourceRevision: stale contract; expected ${expectedSourceRevision}, got ${parsed.data.sourceRevision}`);
  return {valid:blockers.length===0,blockers,protocol:parsed.success?parsed.data:null,browserAuthorized:false,simulatorAuthorized:false};
}

