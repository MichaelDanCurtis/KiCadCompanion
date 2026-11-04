import React,{useEffect,useRef,useState} from 'react';
import {artifactKinds} from '../shared/project.mjs';
import {ActionControls} from './action-controls.jsx';
import {ProductAgent} from './product-agent.jsx';
import {WorkspaceSplit} from './workspace-split.jsx';
import {ArtifactWorkbench} from './artifact-workbench.jsx';
import {useWorkspaceView, WorkspaceViewControls, controllerHeaders} from './workspace-view.jsx';

async function api(path='',body,token){const r=await fetch(`/api/product-projects${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...controllerHeaders(path.split('/')[1]),...(token?{'X-Benchline-Controller':token}:{})},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw new Error(result.error||'Project request failed');return result;}
const emptyArtifact=()=>({name:'',kind:'electrical',path:'',dependsOn:[]});
export function ProjectModel({briefRecord}) {
  const [formsOpen,setFormsOpen]=useState(false);
  const agentDrafts = useRef(new Map());
  const [projects,setProjects]=useState([]),[project,setProject]=useState(null),[name,setName]=useState(''),[root,setRoot]=useState('');
  const [artifact,setArtifact]=useState(emptyArtifact),[requirement,setRequirement]=useState({name:'',text:'',dependsOn:[]});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(true);
  const control=useWorkspaceView(project);
  const selectedId=control.view?.selection;
  const observedProject=control.view?.project;
  const displayProject=observedProject && observedProject.hash===project?.hash &&
    (observedProject.local.history.at(-1)?.observedAt||'') >= (project.local.history.at(-1)?.observedAt||'') ? observedProject:project;
  const artifactDirty=!!(artifact.name||artifact.path||artifact.dependsOn.length||artifact.kind!=='electrical');
  const requirementDirty=!!(requirement.name||requirement.text||requirement.dependsOn.length);
  const formDirty=artifactDirty||requirementDirty;
  useEffect(()=>{if(!formDirty)return;const warn=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[formDirty]);
  useEffect(()=>{let cancelled=false;api().then(r=>{if(!cancelled){setProjects(r.projects);setLoading(false);}}).catch(e=>{if(!cancelled){setError(e.message);setLoading(false);}});return()=>{cancelled=true;};},[]);
  const m=project?.manifest,nodes=m?[...m.requirements,...m.artifacts]:[];
  async function perform(action){setBusy(true);setError('');setMessage('');try{const result=await action();setProject(result);setProjects((await api()).projects);return result;}catch(e){setError(e.message);return null;}finally{setBusy(false);}}
  async function create(fromBrief=false){const result=await perform(()=>api('',{name:fromBrief?briefRecord.brief.name:name,...(fromBrief?{briefId:briefRecord.id,briefRevision:briefRecord.revision}:{})}));if(result)setMessage('Project created in its own folder. No design files or permissions were imported.');}
  async function saveArtifact(e){e.preventDefault();const result=await perform(()=>api(`/${m.id}/artifacts`,{expectedRevision:m.revision,expectedHash:project.hash,artifact},control.controllerToken));if(result){setArtifact(emptyArtifact());setMessage('Artifact reference registered. Its file was not created or edited.');}}
  async function saveRequirement(e){e.preventDefault();const result=await perform(()=>api(`/${m.id}/requirements`,{expectedRevision:m.revision,expectedHash:project.hash,requirement},control.controllerToken));if(result){setRequirement({name:'',text:'',dependsOn:[]});setMessage('Requirement saved. Dependent work is flagged for review, not automatically regenerated.');}}
  function dependencies(value,onChange,exclude){return <fieldset className="model-dependencies"><legend>Depends on (optional)</legend>{nodes.filter(n=>n.id!==exclude).map(n=><label key={n.id}><input type="checkbox" checked={value.includes(n.id)} onChange={e=>onChange(e.target.checked?[...value,n.id]:value.filter(id=>id!==n.id))}/>{n.name}</label>)}{nodes.length===0&&<p>Add a requirement first to link dependent work.</p>}</fieldset>;}
  return <section className="project-model">
    <div className="product-kicker">VERSIONED PRODUCT MODEL</div><h1>Everything belongs to a product.</h1><p className="product-lead">Link requirements and native files, then see what a change affects. This tracks dependencies—it does not run tools or rewrite designs.</p>
    {error&&<p className="product-alert" role="alert">{error} Your form inputs remain here. A save interrupted after manifest replacement may have committed; refresh before retrying.</p>}{message&&<p role="status" className="product-notice">{message}</p>}
    {loading?<p role="status">Loading projects…</p>:<div className="model-start">
      <fieldset disabled={busy||formDirty}><legend>Start a product project</legend><label className="product-field">Project name<input aria-label="New project name" value={name} onChange={e=>setName(e.target.value)} maxLength={100}/></label><button className="product-button" disabled={!name.trim()} onClick={()=>create()}>Create empty project</button>{briefRecord&&<button className="product-button" disabled={!briefRecord.brief.name.trim()} onClick={()=>create(true)}>Create from saved brief</button>}<p>Creates a separate managed folder. Brief import is a snapshot; later brief edits do not silently alter this project.</p></fieldset>
      <fieldset disabled={busy||formDirty}><legend>Open a product project</legend><label className="product-field">Registered projects<select aria-label="Registered projects" value={m?.id||''} onChange={e=>perform(()=>api(`/${e.target.value}`))}><option value="" disabled>Choose a project…</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="product-field">Existing or moved project folder<input aria-label="Existing project folder" value={root} onChange={e=>setRoot(e.target.value)} placeholder="Folder containing benchline.project.json"/></label><button className="product-button" disabled={!root.trim()} onClick={()=>perform(()=>api('/open',{root}))}>Open folder manifest</button><p>Reads an existing Benchline manifest. Does not migrate or modify native CAD files.</p></fieldset>
    </div>}
    {m&&<WorkspaceViewControls control={control}/>}
    {m&&<WorkspaceSplit scope={`project:${m.id}`} primary={<>
      {formDirty&&<p className="product-save-state">Save the form before switching projects, or <button className="product-button" disabled={busy} onClick={()=>{setArtifact(emptyArtifact());setRequirement({name:'',text:'',dependsOn:[]});}}>Clear unsaved model forms</button></p>}
      <div className="product-section-heading"><h2>{m.name} · revision {m.revision}</h2><button className="product-button" disabled={busy||formDirty} onClick={()=>perform(()=>api(`/${m.id}`))}>Refresh saved-file observations</button></div>
      <p className="model-path">Project folder: <code>{project.root}</code><br/>Stable ID: <code>{m.id}</code></p>
      {project.relocated&&<p className="product-alert">Project relocation detected. Local permissions were invalidated and locators rechecked; editor state must be observed again.</p>}
      <div className="product-boundary"><p>Saved hashes describe disk files only. Live editor state appears only when a configured observer verifies this exact document and native editor. Missing or stale observations remain unavailable. Observations do not grant permission; inspect Action controls below for scoped permissions.</p></div>
      <details className="model-editors" open={formsOpen} onToggle={e=>setFormsOpen(e.currentTarget.open)}><summary>Add requirements or register files</summary>
      <div className="model-start">
        <form onSubmit={saveRequirement}><fieldset disabled={busy||artifactDirty||!control.canControl}><legend>{requirement.id?'Edit requirement':'Add requirement'}</legend><label className="product-field">Requirement name<input aria-label="Requirement name" value={requirement.name} onChange={e=>setRequirement(r=>({...r,name:e.target.value}))} maxLength={160} required/></label><label className="product-field">Requirement text<textarea aria-label="Requirement text" value={requirement.text} onChange={e=>setRequirement(r=>({...r,text:e.target.value}))} maxLength={4000} required/></label>{dependencies(requirement.dependsOn,value=>setRequirement(r=>({...r,dependsOn:value})),requirement.id)}<button className="product-button primary" type="submit">Save requirement</button>{requirement.id&&<button className="product-button" type="button" onClick={()=>setRequirement({name:'',text:'',dependsOn:[]})}>Cancel editing requirement</button>}</fieldset></form>
        <form onSubmit={saveArtifact}><fieldset disabled={busy||requirementDirty||!control.canControl}><legend>Register a native file</legend><label className="product-field">Artifact name<input aria-label="Artifact name" value={artifact.name} onChange={e=>setArtifact(a=>({...a,name:e.target.value}))} maxLength={160} required/></label><label className="product-field">Discipline<select aria-label="Artifact discipline" value={artifact.kind} onChange={e=>setArtifact(a=>({...a,kind:e.target.value}))}>{artifactKinds.map(k=><option key={k}>{k}</option>)}</select></label><label className="product-field">Project-relative file path<input aria-label="Artifact file path" value={artifact.path} onChange={e=>setArtifact(a=>({...a,path:e.target.value}))} placeholder="firmware/main.cpp" maxLength={400} required/></label>{dependencies(artifact.dependsOn,value=>setArtifact(a=>({...a,dependsOn:value})))}<button className="product-button primary" type="submit">Register file reference</button></fieldset></form>
      </div>
      </details>
      <ArtifactWorkbench key={m.id} controllerToken={control.controllerToken} project={displayProject} selectedId={selectedId} onSelect={control.select} canEdit={!busy&&!formDirty&&control.canControl}
        onEditRequirement={r=>{setRequirement({id:r.id,name:r.name,text:r.text,dependsOn:r.dependsOn});setFormsOpen(true);}}/>
      <details className="product-history"><summary>Revision observations ({project.local.history.length})</summary><pre>{JSON.stringify(project.local.history,null,2)}</pre></details>
    </>} secondary={<>
      <ProductAgent key={`${m.id}-${project.hash}-${project.local.epoch}-${control.controllerToken||'observer'}`} project={displayProject} controllerToken={control.controllerToken} readOnly={!control.canControl} selectedArtifactId={selectedId} initialDraft={agentDrafts.current.get(m.id) || ''} onDraft={text => agentDrafts.current.set(m.id, text)}/>
      <ActionControls key={m.id} project={m} controllerToken={control.controllerToken} readOnly={!control.canControl}/>
    </>}/> }
  </section>;
}
