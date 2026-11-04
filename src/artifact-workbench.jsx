import React, {useEffect, useState} from 'react';
import {ModuleLibrary} from './module-library.jsx';
import {WorkflowPanel} from './workflow-panel.jsx';
import {ArtifactEditor} from './artifact-editor.jsx';
import {FirmwareStatusPanel} from './firmware-status.jsx';
import {MechanicalStatusPanel} from './mechanical-status.jsx';
import {ApplicationStatusPanel} from './application-status.jsx';
import {IntegrationStatusPanel} from './integration-status.jsx';
import {PhysicalStatusPanel} from './physical-status.jsx';
import {ReleaseStatusPanel} from './release-status.jsx';

const sections = [
  ['requirements','Requirements'], ['bom','Modules / BOM'], ['electrical','Electronics'],
  ['firmware','Firmware'], ['mechanical','Mechanical'], ['application','App'], ['evidence','Verification'],
];

export function ArtifactContext({artifact, observation, impact, compact = false}) {
  const [now,setNow] = useState(Date.now);
  useEffect(() => {const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  if (!artifact) return <p className="artifact-context">No artifact selected. Select a registered file in the workspace to inspect its context.</p>;
  const live=observation?.live;
  const age=now-Date.parse(live?.observedAt);
  const fresh=live?.status==='observed' && age>=0 && age<10000;
  return <section className="artifact-context" aria-label="Selected artifact context">
    <h3>{artifact.name}</h3><p><code>{artifact.path}</code></p>
    <p>Saved file: {observation?.saved?.status || 'not observed'} · Editor: {fresh ? live.dirty ? 'unsaved changes' : 'observed clean' : live?.status==='observed' ? 'stale — refresh required' : 'unavailable / disconnected'}</p>
    {impact?.changed.includes(artifact.id) ? <p>Changed · dependent work needs review</p> : impact?.downstream.includes(artifact.id) ? <p>Needs review · an input changed</p> : null}
    {!compact && <p>Saved hash: <code>{observation?.saved?.hash || 'Unavailable'}</code></p>}
    <p>Viewing a file does not include it in the agent scope or approve an action. Each action checks its own current revision.</p>
  </section>;
}

export function ArtifactWorkbench({project, selectedId, onSelect, onEditRequirement, canEdit, controllerToken}) {
  const [section,setSection]=useState('requirements');
  const m=project.manifest, nodes=[...m.requirements,...m.artifacts];
  const artifacts=m.artifacts.filter(a=>a.kind===section);
  const selected=m.artifacts.find(a=>a.id===selectedId);
  return <section className="artifact-workbench" aria-label="Product disciplines">
    <nav className="discipline-navigation" aria-label="Product disciplines">
      {sections.map(([id,label])=><button className="product-button" type="button" key={id}
        aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}
    </nav>
    <h2>{sections.find(([id])=>id===section)[1]}</h2>
    {section==='requirements' ? <div className="model-nodes">
      {!m.requirements.length && <p>No requirements recorded yet. Add a requirement to define the product and link dependent work.</p>}
      {m.requirements.map(r=><article key={r.id}><h3>{r.name} <span className="product-tag">revision {r.revision}</span></h3><p>{r.text}</p>
        <p>Depends on: {r.dependsOn.map(id=>nodes.find(n=>n.id===id)?.name).join(', ')||'none'}</p>
        <button type="button" className="product-button" disabled={!canEdit} onClick={()=>onEditRequirement(r)}>Edit {r.name}</button>
      </article>)}
    </div> : <>
      <p className="discipline-availability">{section==='electrical' ? 'Select a registered PCB to request opening in the configured KiCad editor. Opening does not authorize authoring or verify live editor state.' : section==='bom' ? 'Local module proposals and BOM review are available. Source retrieval availability is shown in the module library.' : section==='evidence' ? 'Registered evidence references and durable input verification plans.' : 'File references are available; execution for this discipline is not implemented yet.'}</p>
      {section==='firmware'&&<FirmwareStatusPanel/>}
      {section==='mechanical'&&<MechanicalStatusPanel/>}
      {section==='application'&&<ApplicationStatusPanel/>}
      {section==='evidence'&&<IntegrationStatusPanel/>}
      {section==='evidence'&&<PhysicalStatusPanel/>}
      {section==='evidence'&&<ReleaseStatusPanel/>}
      {!artifacts.length && section!=='bom' && <p>No {sections.find(([id])=>id===section)[1].toLowerCase()} files registered.</p>}
      <div className="model-nodes">{artifacts.map(a=><article key={a.id}>
        <button type="button" className="product-button" aria-pressed={selectedId===a.id} onClick={()=>onSelect(a.id)}>Select {a.name}</button>
        <p><code>{a.path}</code></p><p>Saved file: {project.local.observations[a.id]?.saved.status || 'not observed'}</p>
        <p>Depends on: {a.dependsOn.map(id=>nodes.find(n=>n.id===id)?.name).join(', ')||'none'}</p>
      </article>)}</div>
    </>}
    {section==='bom'&&<ModuleLibrary key={m.id} project={project} canControl={canEdit} controllerToken={controllerToken}/>}
    {section==='evidence'&&<WorkflowPanel key={m.id} project={project} canControl={canEdit} controllerToken={controllerToken}/>}
    {selectedId && <><ArtifactContext artifact={m.artifacts.find(a=>a.id===selectedId)} observation={project.local.observations[selectedId]} impact={project.impact}/>
      {selected?.kind==='electrical'&&selected.path.endsWith('.kicad_pcb')&&<ArtifactEditor key={`${m.id}-${selected.id}-${project.hash}`} project={project} artifact={selected} canControl={canEdit} controllerToken={controllerToken}/>}
      <button type="button" className="product-button" onClick={()=>onSelect(null)}>Clear selection</button></>}
  </section>;
}
