import React,{useEffect,useRef,useState} from 'react';
import {controllerHeaders} from './workspace-view.jsx';

export function WorkflowPanel({project,canControl,controllerToken}) {
  const [plans,setPlans]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loadError,setLoadError]=useState('');
  const projectId=project.manifest.id;
  const requestVersion=useRef(0),mutationActive=useRef(false);
  const request=async(path,body)=>{
    const response=await fetch(`/api/workflows${path}`,body?{method:'POST',headers:{'Content-Type':'application/json',...controllerHeaders(projectId),...(controllerToken?{'X-Benchline-Controller':controllerToken}:{})},body:JSON.stringify(body)}:{});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Workflow request failed');return result;
  };
  useEffect(()=>{
    let active=true,pending=false;
    const poll=async()=>{if(pending||mutationActive.current)return;pending=true;const version=requestVersion.current;try{const result=await request(`/projects/${projectId}`);if(active&&version===requestVersion.current){setPlans(result.plans);setLoadError('');}}
      catch(e){if(active)setLoadError(e.message);}finally{pending=false;}};
    poll();const timer=setInterval(poll,3000);return()=>{active=false;clearInterval(timer);};
  },[projectId,project.hash]);
  const perform=async(path,extra={})=>{
    if(!canControl||mutationActive.current)return;mutationActive.current=true;requestVersion.current++;setBusy(true);setError('');
    try{const {plan}=await request(path,{requestId:crypto.randomUUID(),...extra});setPlans(previous=>[plan,...previous.filter(p=>p.id!==plan.id)]);}
    catch(e){setError(e.message);}finally{mutationActive.current=false;setBusy(false);}
  };
  return <section className="workflow-panel" aria-label="Durable verification plans">
    <h3>Verification plans</h3>
    <p>Review registered requirements and saved files at a recorded revision. These checks do not establish native editor state, design correctness, or physical acceptance.</p>
    <button className="product-button" disabled={!canControl||busy} onClick={()=>perform(`/projects/${projectId}/propose`,{expectedHash:project.hash})}>Propose input verification</button>
    {!canControl&&<p>Open the controlling workspace to propose or run verification.</p>}
    {(error||loadError)&&<p role="alert" className="product-alert">{error||loadError}</p>}
    {!plans.length&&<p>No durable verification plans recorded.</p>}
    {plans.map(plan=><article key={plan.id} data-plan-id={plan.id} className="workflow-plan">
      <h4>{plan.title}</h4>
      <button className="product-button" disabled={!canControl||busy||plan.tasks.every(t=>t.state!=='proposed')} onClick={()=>perform(`/${plan.id}/activate`)}>Review plan prerequisites</button>
      <ol>{plan.tasks.map(task=><li key={task.id} className="workflow-task">
        <h4>{task.title} <span className="product-tag">{task.stale?'Stale · ':''}{task.state}</span></h4>
        <p>{task.reason}</p>
        <p>Acceptance: {task.acceptance.map(c=>c.description).join('; ')}</p>
        {task.dependencies.length>0&&<p>Requires: {task.dependencies.map(id=>plan.tasks.find(t=>t.id===id)?.title||id).join(', ')}</p>}
        {task.state==='ready'&&<button className="product-button" disabled={!canControl||busy||task.stale} onClick={()=>perform(`/${plan.id}/tasks/${task.id}/run`)}>Run {task.title}</button>}
        {task.state==='verifying'&&<button className="product-button" disabled={!canControl||busy} onClick={()=>perform(`/${plan.id}/tasks/${task.id}/verify`)}>Resume verification of {task.title}</button>}
        {task.state==='unknown-outcome'&&<button className="product-button" disabled={!canControl||busy} onClick={()=>perform(`/${plan.id}/tasks/${task.id}/observe`)}>Observe outcome of {task.title}</button>}
        {['failed','interrupted'].includes(task.state)&&<button className="product-button" disabled={!canControl||busy||task.stale} onClick={()=>perform(`/${plan.id}/tasks/${task.id}/retry`)}>Review retry of {task.title}</button>}
        {!!task.evidence.length&&<ul>{task.evidence.map(e=><li key={e.id}>{e.criterion}: {e.record.passed?'passed':'failed'} · {e.current?'current':'historical'} — {e.record.summary}<details><summary>Evidence details</summary><p><code>{e.record.locator}</code></p><p>Revision: <code>{e.record.revision}</code></p></details></li>)}</ul>}
        {!!task.attempts.length&&<details><summary>Attempt history ({task.attempts.length})</summary><ul>{task.attempts.map(a=><li key={a.id}>{a.phase} · {a.updatedAt}{a.error&&` · ${a.error}`}</li>)}</ul></details>}
      </li>)}</ol>
    </article>)}
  </section>;
}
