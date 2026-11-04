import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat,readFile} from 'node:fs/promises';
import {z} from 'zod';
import {contentHash,resolveArtifact} from './projects.mjs';

const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid();
const requestSchema=z.object({requestId:uuid,expectedManifestHash:hash,expectedEpoch:uuid,expectedSavedHash:hash}).strict();
const fail=(message,status=409)=>Object.assign(Error(message),{status});
async function observeSaved(root,locator){const path=await resolveArtifact(root,locator);const savedHash=contentHash(await readFile(path));await resolveArtifact(root,locator);return {path,savedHash};}

// Explicit manual opening only. No shell, arbitrary program, document creation,
// provider tool, auto-connect, save, or inferred live-editor authorization.
export class ArtifactEditors {
  constructor({projects,authorize,editor,platform=process.platform,launch=async(editor,path)=>promisify(execFile)('/usr/bin/open',['-a',editor,path],{timeout:15000}),available=async editor=>(await stat(editor)).isDirectory(),observe=observeSaved}){
    Object.assign(this,{projects,authorize,editor,platform,launch,available,observe});this.pending=Promise.resolve();this.requests=new Map();
  }
  async capabilities(){let supported=false;try{supported=this.platform==='darwin'&&await this.available(this.editor);}catch{}
    return {pcb:{supported,...(!supported?{reason:'A configured macOS PCB Editor application is required for opening from this workspace.'}:{})},scope:'Open a registered saved PCB in the configured editor. Opening is not a live connection or design authorization.'};
  }
  open(projectId,artifactId,raw,token){
    uuid.parse(projectId);uuid.parse(artifactId);const input=requestSchema.parse(raw);this.authorize(projectId,token);
    const fingerprint=contentHash(JSON.stringify([projectId,artifactId,input]));
    const prior=this.requests.get(input.requestId);
    if(prior){if(prior.fingerprint!==fingerprint)throw fail('Opening request identity was reused for a different target');return prior.promise;}
    if(this.requests.size>=1000)throw fail('Editor request history is full; inspect open windows before restarting');
    const promise=this.pending.then(async()=>{
      this.authorize(projectId,token);
      if(!(await this.capabilities()).pcb.supported)throw fail('Native editor opening is unavailable',422);
      const project=await this.projects.open(projectId),artifact=project.manifest.artifacts.find(a=>a.id===artifactId);
      if(project.hash!==input.expectedManifestHash||project.local.epoch!==input.expectedEpoch)throw fail('Project changed; refresh before opening its file');
      if(!artifact||artifact.kind!=='electrical'||!artifact.path.endsWith('.kicad_pcb'))throw fail('Only registered PCB artifacts can open in this editor',422);
      const saved=project.local.observations[artifactId]?.saved;
      if(saved?.status!=='saved'||saved.hash!==input.expectedSavedHash)throw fail('Saved file changed or is missing; refresh before opening');
      const {path,savedHash}=await this.observe(project.root,artifact.path);
      if(savedHash!==input.expectedSavedHash)throw fail('Saved file changed before opening');
      this.authorize(projectId,token);
      await this.launch(this.editor,path);
      return {status:'opening-requested',projectId,artifactId,savedHash:input.expectedSavedHash,requestedAt:new Date().toISOString(),
        liveVerified:false,detail:'Opening requested. Confirm the file in KiCad; this does not verify a live editor connection or authorize changes.'};
    });
    this.pending=promise.catch(()=>{});this.requests.set(input.requestId,{fingerprint,promise});return promise;
  }
}
export function artifactEditorRoutes(app,editors){
  app.get('/api/artifact-editors/capabilities',async(req,res)=>res.json(await editors.capabilities()));
  app.post('/api/artifact-editors/:projectId/:artifactId/open',async(req,res)=>res.json(await editors.open(req.params.projectId,req.params.artifactId,req.body,req.get('X-Benchline-Controller'))));
}
