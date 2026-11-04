import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProductAgent} from '../../src/product-agent.jsx';
import {ActionControls} from '../../src/action-controls.jsx';
import {useWorkspaceView,WorkspaceViewControls} from '../../src/workspace-view.jsx';
import {ReviewWindow} from '../../src/review-window.jsx';
import {WorkspaceSplit} from '../../src/workspace-split.jsx';
import '../../src/style.css';
import '../../src/product-workspace.css';

function ControlledFixture({project}) {
  const control=useWorkspaceView(project);
  return <><WorkspaceViewControls control={control}/><WorkspaceSplit scope={`fixture:${project.manifest.id}`}
    primary={<section><h2>Selected fixture</h2><p>{project.manifest.name}</p><button className="product-button" onClick={()=>control.select(project.manifest.artifacts[0].id)}>Select fixture label</button><p>No native design is connected.</p></section>}
    secondary={<><ProductAgent project={project} initialDraft={project.fixturePrompt||''} controllerToken={control.controllerToken} readOnly={!control.canControl} selectedArtifactId={control.view?.selection}/><ActionControls project={project.manifest} controllerToken={control.controllerToken} readOnly={!control.canControl}/></>}/></>;
}

function FixturePage() {
  const [project,setProject]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    const abort=new AbortController();
    fetch('/fixture/project',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('Fixture unavailable');return r.json();})
      .then(setProject).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>abort.abort();
  },[]);
  return <main style={{display:'block',padding:24,maxWidth:1400,margin:'auto'}}>
    <h1>Benchline — disposable approval fixture</h1>
    <p role="note">{project?.fixtureNote || 'TEST ONLY. Scripted provider, real product controller and action journal. No model, credentials, KiCad, customer files or production capability changes. The message becomes a fixture label.'}</p>
    {error?<p role="alert">{error}</p>:null}
    {project?project.workspaceViews?<ControlledFixture project={project}/>:<WorkspaceSplit scope={`fixture:${project.manifest.id}`} primary={<section><h2>Selected fixture</h2><p>{project.manifest.name}</p><p>This disposable label is held in memory. No native design is connected.</p></section>}
      secondary={<><ProductAgent project={project} initialDraft={project.fixturePrompt || ''}/><ActionControls project={project.manifest}/></>}/>:<p>Loading fixture…</p>}
  </main>;
}
const reviewId=new URLSearchParams(window.location.search).get('review');
createRoot(document.getElementById('root')).render(<React.StrictMode>{reviewId?<ReviewWindow viewId={reviewId}/>:<FixturePage/>}</React.StrictMode>);
