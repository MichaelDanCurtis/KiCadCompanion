import {z} from 'zod';
import {resolveArtifact} from './projects.mjs';
import {recoveryDecisionSchema} from '../shared/actions.mjs';
const id=z.string().uuid();
export function projectTargetResolver(projects){return async input=>{const view=await projects.open(input.projectId);const doc=view.manifest.artifacts.find(a=>a.id===input.documentId);if(!doc)throw Object.assign(Error('Document does not belong to this project'),{status:404});return {projectId:view.manifest.id,documentId:doc.id,path:await resolveArtifact(view.root,doc.path),epoch:view.local.epoch,manifestHash:view.hash};};}
export function actionRoutes(app,gate,adapters){
  app.get('/api/actions/capabilities',(req,res)=>res.json({version:1,adapters:[...adapters].map(([name,a])=>({name,version:a.version,operations:a.capabilities()}))}));
  app.get('/api/actions/project/:id',(req,res)=>res.json(gate.list(id.parse(req.params.id))));
  app.post('/api/actions/prepare',async(req,res)=>res.json(await gate.prepare(req.body)));
  app.post('/api/actions/:id/decide',async(req,res)=>res.json(await gate.decide(id.parse(req.params.id),z.enum(['once','always','decline']).parse(req.body.decision))));
  app.post('/api/actions/:id/execute',async(req,res)=>res.json(await gate.execute(id.parse(req.params.id))));
  app.post('/api/actions/:id/cancel',async(req,res)=>res.json(await gate.cancel(id.parse(req.params.id))));
  app.post('/api/actions/:id/inspect',async(req,res)=>res.json(await gate.inspect(id.parse(req.params.id))));
  app.post('/api/actions/:id/recovery-review',async(req,res)=>{z.object({}).strict().parse(req.body);res.json(await gate.reviewRecovery(id.parse(req.params.id)));});
  app.post('/api/actions/:id/reconcile',async(req,res)=>res.json(await gate.reconcile(id.parse(req.params.id),recoveryDecisionSchema.parse(req.body))));
  app.post('/api/action-grants/:id/revoke',async(req,res)=>res.json(await gate.revoke(id.parse(req.params.id))));
}
