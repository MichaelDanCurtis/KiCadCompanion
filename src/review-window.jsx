import React,{useEffect,useState} from 'react';
import {ArtifactWorkbench} from './artifact-workbench.jsx';
import {ActionControls} from './action-controls.jsx';
import {parseAppearance} from '../shared/appearance.mjs';

async function read(path,signal) {
  const response=await fetch(path,{signal,cache:'no-store'});const value=await response.json();
  if(!response.ok)throw Error(value.error||'Review unavailable');return value;
}

// No join, controller token, provider select/turn, or mutation-capable component.
// Opening/reloading a review window only observes an existing workspace view.
export function ReviewWindow({viewId}) {
  const [view,setView]=useState(null),[messages,setMessages]=useState([]),[error,setError]=useState('');
  const [appearance]=useState(()=>{try{return parseAppearance(JSON.parse(localStorage.getItem('benchline.appearance.v1')));}catch{return parseAppearance(null);}});
  useEffect(()=>{
    let stopped=false,timer;const abort=new AbortController();
    async function refresh(){
      try {
        const next=await read(`/api/workspace-views/${encodeURIComponent(viewId)}`,abort.signal);
        if(stopped)return;setView(next);setError('');
        const provider=await read('/api/provider/product',abort.signal);
        if(provider.scope?.projectId===next.projectId && provider.selectionId) {
          const transcript=await read(`/api/provider/product/transcript/${provider.selectionId}`,abort.signal);
          if(!stopped)setMessages(transcript.messages);
        }else if(!stopped)setMessages([]);
      }catch(e){if(!stopped&&e.name!=='AbortError')setError(e.message);}
      if(!stopped)timer=setTimeout(refresh,1500);
    }
    refresh();return()=>{stopped=true;clearTimeout(timer);abort.abort();};
  },[viewId]);
  async function select(artifactId) {
    try {
      const response=await fetch(`/api/workspace-views/${encodeURIComponent(viewId)}/selection`,{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({artifactId,expectedRevision:view.revision})});
      const next=await response.json();if(!response.ok)throw Error(next.error||'Selection unavailable');
      setView(current=>({...current,...next}));setError('');
    }catch(e){setError(e.message);}
  }
  return <div className="app review-window" data-theme={appearance.theme}>
    <header><h1>Benchline review</h1><p>Review only · engineering writes and agent commands belong to the controlling window.</p></header>
    {error&&<p className="product-alert" role="alert">{error} Displayed information may be stale.</p>}
    {view?<>
      <h2>{view.project.manifest.name}</h2><p role="status">Workspace control: {view.phase}</p>
      <ArtifactWorkbench project={view.project} selectedId={view.selection} onSelect={select} canEdit={false} onEditRequirement={()=>{}}/>
      <section aria-label="Shared AI conversation"><h2>Shared AI conversation</h2>
        {!messages.length&&<p>No active conversation for this project.</p>}
        {messages.map(m=><article key={`${m.turnId}-${m.role}-${m.id}`}><h3>{m.role==='user'?'You':'Benchline'}</h3><p>{m.text}</p></article>)}
      </section>
      <ActionControls project={view.project.manifest} readOnly/>
    </>:!error&&<p role="status">Loading shared review…</p>}
  </div>;
}
