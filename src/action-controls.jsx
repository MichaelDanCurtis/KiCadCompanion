import React,{useEffect,useRef,useState} from 'react';
async function request(path,body,signal,controllerToken){const r=await fetch(path,body===undefined?{signal,cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json',...(controllerToken?{'X-Benchline-Controller':controllerToken}:{})},body:JSON.stringify(body),signal});const data=await r.json();if(!r.ok)throw Error(data.error||'Action request failed');return data;}
export function ActionControls({project,controllerToken,readOnly=false}){
  return <ProjectActionControls key={project.id} project={project} controllerToken={controllerToken} readOnly={readOnly}/>;
}
function RecoveryAcknowledgment({action,busy,onAccept}){
  const [note,setNote]=useState(''),[acknowledged,setAcknowledged]=useState(false);
  const review=action.recoveryReview;
  return <form onSubmit={event=>{event.preventDefault();if(acknowledged&&note.trim())onAccept({reviewId:review.id,
    expectedFingerprint:review.fingerprint,decision:'accept-current-state',note:note.trim()});}}>
    <h5>Review current state — not the original outcome</h5><p>{review.inspection.summary}</p>
    <p>Observed revision: <code>{review.inspection.revision}</code>. Review expires at {new Date(review.expiresAt).toLocaleTimeString()}.</p>
    <pre>{JSON.stringify(review.inspection.details,null,2)}</pre>
    <label>Recovery note <input value={note} maxLength={1000} required onChange={event=>setNote(event.target.value)} disabled={busy}/></label>
    <label><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} disabled={busy}/> I accept this inspected current state. The original outcome stays unknown. Old permissions and pending previews will be revoked; this does not retry or approve an action.</label>
    <button className="product-button" type="submit" disabled={busy||!acknowledged||!note.trim()}>Accept inspected state; require fresh actions</button>
  </form>;
}
function ProjectActionControls({project,controllerToken,readOnly}){
  const [data,setData]=useState({actions:[],grants:[]}),[capabilities,setCapabilities]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [syncError,setSyncError]=useState('');
  const alive=useRef(false),generation=useRef(0),inFlight=useRef(0);
  const projectId=project.id;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  useEffect(()=>{
    if(busy)return;
    let stopped=false,timer;const abort=new AbortController(),version=++generation.current;
    const current=()=>!stopped&&alive.current&&version===generation.current;
    async function refresh(initial=false){
      try{
        const [journal,caps]=await Promise.all([request(`/api/actions/project/${projectId}`,undefined,abort.signal),
          initial?request('/api/actions/capabilities',undefined,abort.signal):Promise.resolve(null)]);
        if(current()){setData(journal);if(caps)setCapabilities(caps.adapters);setSyncError('');}
      }catch(e){if(current()&&e.name!=='AbortError')setSyncError('Live action updates unavailable: '+e.message);}
      // Schedule only after the preceding read finishes; never overlap polls.
      if(current())timer=setTimeout(()=>refresh(),1000);
    }
    refresh(true);
    return()=>{stopped=true;clearTimeout(timer);abort.abort();};
  },[projectId,busy]);
  async function act(path,body){
    if(readOnly&&body!==undefined)return;
    generation.current++;inFlight.current++;setBusy(true);setError('');
    try{await request(path,body,undefined,controllerToken);}
    catch(e){if(alive.current)setError(e.message+' Refresh the journal before retrying an uncertain request.');}
    finally{inFlight.current--;if(alive.current)setBusy(inFlight.current>0);}
  }
  return <section className="product-boundary action-controls" aria-label="Action controls"><h2>Action controls</h2>{readOnly&&<p>This window is for review. Decisions and execution belong to the controlling window.</p>}<fieldset className="action-write-controls" disabled={readOnly}>
    <p>Preview → decision → fresh checks → execution → verification. No permission is inferred from conversation or imported from the old board workspace.</p>
    <p>Available actions are listed below for this running instance. Each action still needs its own document, revision and permission checks.</p>
    {error&&<p role="alert" className="product-alert">{error}</p>}
    {syncError&&<p role="alert" className="product-alert">{syncError}</p>}
    <p>Action updates refresh automatically. Pending agent proposals wait for your decision for up to 60 seconds; expired previews require a fresh proposal.</p>
    <button className="product-button" disabled={busy} onClick={()=>act(`/api/actions/project/${projectId}`)}>Refresh action journal</button>
    {capabilities.map(a=><div key={a.name}><h3>{a.name}</h3>{a.operations.map(c=><p key={c.operation}>{c.operation}: {c.supported?c.effect+' capability':`Unavailable — ${c.reason}`}</p>)}</div>)}
    {project.artifacts.filter(a=>a.kind==='electrical'&&a.path.endsWith('.kicad_pcb')).map(a=><button className="product-button" disabled={busy} key={a.id} onClick={()=>act('/api/actions/prepare',{projectId,documentId:a.id,adapter:'konnect',operation:'board-info',args:{},mode:'discuss',idempotencyKey:crypto.randomUUID()})}>Preview metadata read · {a.name}</button>)}
    <h3>Pending &amp; recent actions</h3>{!data.actions.length&&<p>No actions have been requested.</p>}
    {[...data.actions].reverse().map(a=><article className="model-action" key={a.id}><h4>{a.input.adapter} · {a.input.operation} <span className="product-tag">{a.state}</span></h4><p>{a.preview.summary}</p><p>{a.preview.confirmation}</p><p>Document: <code>{a.target.path}</code></p><p>Input revision: <code>{a.observation.revision}</code></p><pre>{JSON.stringify(a.input.args,null,2)}</pre>
      {a.state==='awaiting-approval'&&<><p>Decision deadline: {new Date(a.expiresAt).toLocaleTimeString()}. Always allow covers this exact project, document, action, arguments and confirmation. Every later action needs a fresh preview and revision check.</p><div className="button-row"><button disabled={busy} onClick={()=>act(`/api/actions/${a.id}/decide`,{decision:'once'})}>Allow once</button><button disabled={busy} onClick={()=>act(`/api/actions/${a.id}/decide`,{decision:'decline'})}>Decline</button><button disabled={busy} onClick={()=>act(`/api/actions/${a.id}/decide`,{decision:'always'})}>Always allow</button></div></>}
      {['ready','approved'].includes(a.state)&&<button className="product-button primary" disabled={busy} onClick={()=>act(`/api/actions/${a.id}/execute`,{})}>Execute reviewed action</button>}
      {['ready','approved','awaiting-approval','executing'].includes(a.state)&&<button className="product-button" onClick={()=>act(`/api/actions/${a.id}/cancel`,{})}>Stop future work</button>}
      {a.detail&&<p>{a.detail}</p>}{a.state==='unknown'&&<button className="product-button" disabled={busy} onClick={()=>act(`/api/actions/${a.id}/inspect`,{})}>Inspect uncertain outcome</button>}
      {a.state==='unknown'&&!a.reconciliation&&<button className="product-button" disabled={busy} onClick={()=>act(`/api/actions/${a.id}/recovery-review`,{})}>Prepare recovery review</button>}
      {a.recoveryReview&&!a.reconciliation&&<RecoveryAcknowledgment key={a.recoveryReview.id} action={a} busy={busy} onAccept={decision=>act(`/api/actions/${a.id}/reconcile`,decision)}/>}
      {a.reconciliation&&<p>Current state accepted after review. Original outcome: unknown. No replay authorized; fresh actions need fresh checks and permissions.</p>}
      {(a.receipt||a.recovery||a.reconciliation)&&<details><summary>Evidence / recovery</summary><pre>{JSON.stringify({receipt:a.receipt,verification:a.verification,recovery:a.recovery,reconciliation:a.reconciliation},null,2)}</pre></details>}
    </article>)}
    <h3>Scoped recurring permissions</h3>{!data.grants.length&&<p>No recurring permissions.</p>}{data.grants.map(g=><article key={g.id}><p>{g.adapter} · {g.operation} · <code>{g.path}</code></p><pre>{JSON.stringify(g.args,null,2)}</pre><p>{g.confirmation}</p><button className="product-button" onClick={()=>act(`/api/action-grants/${g.id}/revoke`,{})}>Revoke permission</button></article>)}
    <p>Revocation stops future dispatch, not changes already applied. An uncertain result is not success and cannot be automatically retried.</p>
  </fieldset></section>;
}
