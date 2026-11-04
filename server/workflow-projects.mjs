import {createHash} from 'node:crypto';
const taskId=(requestId,nodeId)=>{const s=createHash('sha256').update(`${requestId}:${nodeId}`).digest('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-5${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20,32)}`;};
import {z} from 'zod';
import {WorkflowStore} from './workflows.mjs';

export function projectInputRevisions(project) {
  return Object.fromEntries([
    ['manifest',project.hash],['location',project.local.epoch],
    ...project.manifest.requirements.map(r=>[`requirement:${r.id}`,`${r.revision}:${r.contentHash}`]),
    ...project.manifest.artifacts.map(a=>[`artifact:${a.id}`,project.local.observations[a.id]?.saved?.hash||'unavailable']),
  ]);
}
// Production adapters only observe registered project inputs. Native edits,
// compilation, model generation and physical acceptance need their own adapters.
export function createProjectWorkflows({path,projects}) {
  const execute=async({task})=>{
    const project=await projects.open(task.params.projectId),observed=projectInputRevisions(project);
    return {observed,manifestHash:project.hash};
  };
  const verify=async({task,output})=>{
    const project=await projects.open(task.params.projectId),current=projectInputRevisions(project);
    const matches=Object.entries(task.inputs).every(([k,v])=>current[k]===v&&output.observed[k]===v&&v!=='unavailable');
    return task.acceptance.map(c=>({criterion:c.id,locator:`project://${task.params.projectId}/${task.params.nodeId||'manifest'}`,
      revision:project.hash,summary:matches?'Registered inputs were observed at the reviewed revision.':'A registered input is unavailable or changed.',passed:matches}));
  };
  const adapters=new Map(['requirement-observation','artifact-observation','project-observation'].map(id=>[id,{execute,verify}]));
  const store=new WorkflowStore({path,adapters,observeInputs:async projectId=>projectInputRevisions(await projects.open(projectId))});
  const propose=async(projectId,expectedHash,requestId)=>{
    const project=await projects.open(projectId);
    if(project.hash!==expectedHash)throw Object.assign(Error('Project changed. Refresh before proposing verification.'),{status:409});
    const inputs=projectInputRevisions(project),nodes=[...project.manifest.requirements,...project.manifest.artifacts];
    const ids=new Map(nodes.map(n=>[n.id,taskId(requestId,n.id)]));
    const tasks=nodes.map(n=>({id:ids.get(n.id),title:`Observe ${n.name}`,adapter:n.kind?'artifact-observation':'requirement-observation',
      dependencies:n.dependsOn.map(id=>ids.get(id)),documents:[],inputs:{manifest:inputs.manifest,location:inputs.location,
        [`${n.kind?'artifact':'requirement'}:${n.id}`]:inputs[`${n.kind?'artifact':'requirement'}:${n.id}`]},
      acceptance:[{id:'registered-input-current',description:'Registered input is available at the reviewed revision'}],params:{projectId,nodeId:n.id}}));
    tasks.push({id:taskId(requestId,'summary'),title:'Verify registered input review',adapter:'project-observation',dependencies:tasks.map(t=>t.id),documents:[],inputs,
      acceptance:[{id:'registered-inputs-current',description:'All registered inputs remain current after the prerequisite observations'}],params:{projectId}});
    return store.create({id:requestId,projectId,title:`Registered input review · revision ${project.manifest.revision}`,tasks},requestId);
  };
  return {store,propose,pending:new Set()};
}

export function workflowRoutes(app,{store,propose,views,pending}) {
  const uuid=z.string().uuid(),token=req=>req.get('X-Benchline-Controller');
  const prefix='/api/workflows';
  const body=z.object({requestId:uuid}).strict();
  const admitted=async(projectId,controller,operation)=>{
    views.authorize(projectId,controller);
    const work=Promise.resolve().then(operation);pending.add(work);
    try{return await work;}finally{pending.delete(work);}
  };
  app.get(`${prefix}/projects/:projectId`,async(req,res)=>{
    const plans=store.list(uuid.parse(req.params.projectId));
    res.set('Cache-Control','no-store').json({plans:await Promise.all(plans.map(p=>store.refresh(p.id)))});
  });
  app.post(`${prefix}/projects/:projectId/propose`,async(req,res)=>{
    const projectId=uuid.parse(req.params.projectId),input=body.extend({expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}).parse(req.body);
    const plan=await admitted(projectId,token(req),()=>propose(projectId,input.expectedHash,input.requestId));res.json({plan});
  });
  app.post(`${prefix}/:planId/activate`,(req,res)=>{
    const input=body.parse(req.body),plan=store.get(uuid.parse(req.params.planId));views.authorize(plan.projectId,token(req));
    res.json({plan:store.activate(plan.id,input.requestId)});
  });
  app.post(`${prefix}/:planId/tasks/:taskId/:operation`,async(req,res)=>{
    const plan=store.get(uuid.parse(req.params.planId)),taskId=uuid.parse(req.params.taskId),input=body.parse(req.body);
    if(!plan.tasks.some(t=>t.id===taskId))throw Error('Task is outside this plan');
    const operation=z.enum(['run','verify','observe','retry']).parse(req.params.operation);
    const result=await admitted(plan.projectId,token(req),()=>operation==='run'?store.run(taskId,input):operation==='verify'?store.resumeVerification(taskId):
      operation==='observe'?store.observeOutcome(taskId):store.reviewRetry(taskId,input.requestId));
    res.json({plan:result});
  });
}
