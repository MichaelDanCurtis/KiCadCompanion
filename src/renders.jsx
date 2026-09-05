import React, {useState} from 'react';
import {Camera, Sparkles, Download, RefreshCw} from 'lucide-react';
import './renders.css';

export function RenderPane({state,run,boardColor}) {
  const [camera,setCamera]=useState('perspective'),[quality,setQuality]=useState('basic');
  const [chosen,setChosen]=useState(null),[working,setWorking]=useState(false);
  const [style,setStyle]=useState('Soft studio lighting, a clean neutral background, and realistic material textures.');
  const jobs=(state.renders||[]).filter(j=>j.board===state.board);
  const job=jobs.find(j=>j.id===chosen)||jobs[0];
  const running=working||jobs.some(j=>['queued','running'].includes(j.status));
  const missing=job?.models?.components?.filter(c=>!c.models.some(m=>m.exists&&m.visible));
  const aiBusy=job?.ai?.status==='running';
  async function render(){setWorking(true);try{const result=await run('renders',{camera,quality,color:boardColor});if(result)setChosen(result.id)}finally{setWorking(false)}}
  return <div className="render-pane">
    <div className="render-heading"><span className="eyebrow">FROM LAYOUT TO OBJECT</span><h2>See what you’re building.</h2><p>KiCad’s real geometry first. Optional AI studio imagery alongside it.</p></div>
    <div className="render-controls"><label>Camera<select value={camera} onChange={e=>setCamera(e.target.value)}><option value="perspective">Perspective</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label><label>Quality<select value={quality} onChange={e=>setQuality(e.target.value)}><option value="basic">Quick preview</option><option value="high">High quality</option></select></label><div className="render-finish"><span>Board finish</span><b>{boardColor==='kicad'?'Saved stackup':boardColor}</b><small>Choose on the Board tab</small></div><button className="small-primary" onClick={render} disabled={running||!state.board}>{running?<RefreshCw className="spin" size={15}/>:<Camera size={15}/>}Render saved board</button></div>
    <p className="source">Save in KiCad first. Unsaved edits are excluded. Finish overrides affect this image only—not fabrication settings. DNP components are omitted.</p>
    {jobs.length>1&&<label className="render-history">Render history<select value={job?.id||''} onChange={e=>setChosen(e.target.value)}>{jobs.map(j=><option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleTimeString()} · {j.options.camera} · {j.options.color} · {j.status}</option>)}</select></label>}
    {jobs.some(j=>j.ai?.status==='completed')&&<button className="small-primary" onClick={()=>setChosen(jobs.find(j=>j.ai?.status==='completed').id)}><Sparkles size={13}/>Latest AI comparison</button>}
    <div className="render-pair">
      <article className="render-card"><header><span><Camera size={14}/> Actual KiCad render</span><b className="render-tag">SAVED SNAPSHOT</b></header>
        {job?.status==='completed'?<a href={`/api/renders/${job.id}/actual.png?v=2`} target="_blank" rel="noreferrer"><img src={`/api/renders/${job.id}/actual.png?v=2`} alt={`Actual ${job.options.camera} KiCad render, ${job.options.color} finish`}/></a>:<div className="render-placeholder"><Camera size={38}/><strong>{job?.status==='failed'?'Render failed':job?.stage||'Your board, in three dimensions'}</strong><p role={job?.error?'alert':undefined}>{job?.error||'Assigned component models appear automatically.'}</p></div>}
        {job?.status==='completed'&&<footer><span>{job.options.camera} · {job.options.color}</span><a href={`/api/renders/${job.id}/actual.png?v=2`} download={`kicad-${job.id}.png`}><Download size={13}/>PNG</a></footer>}
      </article>
      <article className="render-card ai"><header><span><Sparkles size={14}/> AI studio</span><b className="render-tag">ILLUSTRATIVE</b></header>
        {job?.ai?.status==='completed'?<a href={`/api/renders/${job.id}/ai.png?v=2-${encodeURIComponent(job.ai.completedAt)}`} target="_blank" rel="noreferrer"><img src={`/api/renders/${job.id}/ai.png?v=2-${encodeURIComponent(job.ai.completedAt)}`} alt="AI-generated studio interpretation, not an engineering reference"/></a>:<div className="render-placeholder"><Sparkles size={38}/><strong>{aiBusy?'Creating your studio image…':'A little studio magic.'}</strong><p role={job?.ai?.error?'alert':undefined}>{job?.ai?.error||'Lighting, materials and presentation, guided by the actual render.'}</p></div>}
        {job?.ai?.status==='completed'&&<footer><span>Codex image generation</span><a href={`/api/renders/${job.id}/ai.png?v=2-${encodeURIComponent(job.ai.completedAt)}`} download={`illustrative-${job.id}.png`}><Download size={13}/>PNG</a></footer>}
      </article>
    </div>
    {job&&<div className="render-evidence"><span className="eyebrow">MODEL COVERAGE</span>{missing?<p>{job.models.components.length-missing.length} of {job.models.components.length} footprints have a visible model file available.{missing.length>0&&<> Missing or hidden: <strong>{missing.map(c=>c.reference).join(', ')}</strong>. These parts are not represented in 3D; AI is instructed not to invent them.</>}</p>:<p>{job.models?.error||'Coverage is checked during rendering.'}</p>}<p className="source">{job.models?.source} · File saved {new Date(job.source.fileModifiedAt).toLocaleString()} · SHA-256 {job.source.sha256.slice(0,12)}<br/>Historical snapshot; render again after saving changes. Available files are not a dimensional validation.</p></div>}
    <div className="studio-controls"><label>Studio direction<textarea value={style} maxLength={1200} onChange={e=>setStyle(e.target.value)} rows={2}/></label><button className="small-primary" disabled={!state.agent.imageGeneration||!state.agent.signedIn||state.agent.busy||working||job?.status!=='completed'||aiBusy} onClick={async()=>{setWorking(true);try{await run(`renders/${job.id}/studio`,{style})}finally{setWorking(false)}}}><Sparkles size={15}/>{aiBusy?'Generating…':'Generate AI studio image'}</button><p className="source">{!state.agent.imageGeneration?'Image generation requires a connected Codex runtime with image support.':'Uses your Codex login and included usage. Sends this rendered image and its model-coverage report to OpenAI.'} AI can alter geometry or labels: use only the actual PCB and engineering checks for design decisions.</p></div>
  </div>;
}
