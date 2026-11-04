import React, {useEffect, useState} from 'react';
import {ArrowRight, ArrowLeft, Plus, Compass, Check, Circle, Layers, GitBranch, ShieldCheck} from 'lucide-react';
import {emptyBrief, briefProblems, disciplines, proposePlan} from '../shared/product-brief.mjs';
import './product-workspace.css';
import {ProjectModel} from './project-model.jsx';
import {ProviderAccountSetup} from './provider-account.jsx';
import {WorkspaceSplit} from './workspace-split.jsx';

async function request(path='', body) {
  const response=await fetch(`/api/product-briefs${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Could not save this brief. Your edits have been kept.');
  return data;
}
const stepNames=['The idea','Requirements','Build plan'];
const labels={audience:'Who is it for?',power:'Power',connectivity:'Connections and protocols',dimensions:'Size and mounting',environment:'Operating environment',budget:'Cost target',constraints:'Other constraints'};
const hints={audience:'Who will use it, and what problem are they solving?',power:'USB, battery, mains adapter… include known voltage or runtime.',connectivity:'What does it talk to? Include ports, wireless links, or APIs.',dimensions:'Size limits, mounting points, connector access, or an existing object to fit.',environment:'Indoor, outdoor, temperatures, water, dust, or other conditions.',budget:'Prototype budget, target unit cost, or “not yet decided”.',constraints:'Must-use parts, deadlines, privacy, licensing, accessibility, or safety needs.'};

function PlanTasks({plan}) {
  return <ol className="product-task-list">{plan.tasks.map((task,index)=><li key={task.id}>
    <span className="product-task-number">{index+1}</span><div><div className="product-task-heading"><h3>{task.title}</h3><span className="product-tag">Not started</span></div>
    <p>{task.tool} · {task.output}</p><details><summary>Dependencies &amp; review checkpoint</summary><p>After: {task.dependsOn.map(id=>plan.tasks.find(t=>t.id===id)?.title||id).join('; ')||'Plan approval'}</p><p>{task.check}</p></details></div>
  </li>)}</ol>;
}

export function ProductWorkspace({onOpenElectronics}) {
  const [modelOpen,setModelOpen]=useState(false);
  const [records,setRecords]=useState([]),[record,setRecord]=useState(null),[brief,setBrief]=useState(emptyBrief);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  const [screen,setScreen]=useState('wizard'),[step,setStep]=useState(0),[notice,setNotice]=useState('');
  function selectRecord(next) {setRecord(next);setBrief(next?structuredClone(next.brief):emptyBrief());setDirty(false);setStep(0);setScreen(next?.approvedRevision===next?.revision&&next?'dashboard':'wizard');setError('');setNotice('');}
  useEffect(()=>{let disposed=false;request().then(data=>{if(!disposed){setRecords(data.records);selectRecord(data.records[0]||null);setLoading(false);}}).catch(e=>{if(!disposed){setError(e.message);setLoading(false);}});return()=>{disposed=true;};},[]);
  useEffect(()=>{if(!dirty)return;const warn=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  function change(field,value) {setBrief(b=>({...b,[field]:value}));setDirty(true);setNotice('');}
  function remember(next) {setRecords(all=>[next,...all.filter(r=>r.id!==next.id)]);setRecord(next);setBrief(next.brief);setDirty(false);}
  async function save(nextStep) {
    setBusy(true);setError('');
    try {const next=await request(record?`/${record.id}/update`:'',record?{expectedRevision:record.revision,brief}:{brief});remember(next);setNotice(`Draft saved locally · revision ${next.revision}`);if(nextStep!==undefined)setStep(nextStep);return next;}
    catch(e){setError(e.message);return null;}finally{setBusy(false);}
  }
  async function approve() {
    setBusy(true);setError('');
    try {
      // Review always refers to the exact saved revision. Approval cannot dispatch tools.
      if(dirty||!record)throw new Error('Save the brief before approving its plan.');
      const next=await request(`/${record.id}/approve`,{expectedRevision:record.revision,scope:'plan-only'});
      remember(next);setScreen('dashboard');setNotice('Plan approved. No tools have run and no files were changed in your engineering tools.');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const plan=dirty||!record?proposePlan(brief):record.plan,problems=briefProblems(brief),has=id=>brief.disciplines.includes(id);
  const changedApproval=record?.history.some(h=>h.approvedAt)&&record.approvedRevision!==record.revision;
  function field(name,multiline=false) {
    const props={id:`brief-${name}`,value:brief[name],onChange:e=>change(name,e.target.value),placeholder:hints[name],maxLength:name==='constraints'?2000:name==='connectivity'?800:500};
    return <label className="product-field" key={name} htmlFor={props.id}><span>{labels[name]} <small>Optional for now</small></span>{multiline?<textarea {...props} rows={3}/>:<input {...props}/>}</label>;
  }
  if(loading)return <main className="product-workspace"><p role="status">Loading your product workspace…</p></main>;
  return <main className="product-workspace">
    <div className="product-toolbar"><div><Compass size={17}/><span>Product workspace</span><button className="product-button" aria-pressed={!modelOpen} onClick={()=>setModelOpen(false)}>Brief &amp; plan</button><button className="product-button" aria-pressed={modelOpen} onClick={()=>setModelOpen(true)}>Project model</button></div><div>
      {records.length>0&&<select aria-label="Saved product briefs" value={record?.id||''} disabled={dirty||busy} onChange={e=>selectRecord(records.find(r=>r.id===e.target.value))}><option value="" disabled>New product</option>{records.map(r=><option value={r.id} key={r.id}>{r.brief.name||'Untitled draft'} · {r.approvedRevision===r.revision?'plan approved':'draft'}</option>)}</select>}
      <button className="product-button" disabled={dirty||busy} onClick={()=>selectRecord(null)}><Plus size={14}/>New product</button>
    </div></div>
    <ProviderAccountSetup/>
    {error&&<div className="product-alert" role="alert">{error}<span>Your current inputs have not been replaced. Save a copy of your text before reloading to resolve a revision conflict.</span></div>}
    {notice&&<p className="product-notice" role="status">{notice}</p>}
    <div className="model-shell" hidden={!modelOpen}><ProjectModel briefRecord={record}/></div>
    <div className="brief-shell" hidden={modelOpen}><WorkspaceSplit scope={`brief:${record?.id || 'new'}`} primaryLabel="Brief & plan" secondaryLabel="Build guide" primary={
      <section className="product-primary">
        {screen==='wizard'?<>
          <nav className="product-steps" aria-label="Product setup">{stepNames.map((name,i)=><button key={name} disabled={busy} aria-current={step===i?'step':undefined} onClick={()=>setStep(i)}><span>{i+1}</span>{name}</button>)}</nav>
          <div className="product-kicker">{record?`BRIEF / REVISION ${record.revision}`:'FROM IDEA TO PRODUCT'}</div>
          <h1>{step===0?'What are we building?':step===1?'Let’s define the essentials.':'Here’s the proposed path.'}</h1>
          <p className="product-lead">{step===0?'Start with the outcome. Benchline organizes the work around your product, then brings in the right tools.':step===1?'Tell us what you know. Leave anything uncertain blank—we’ll keep it as an open decision.':'Review the sequence, dependencies, and checkpoints before any engineering work begins.'}</p>
          {changedApproval&&<div className="product-alert">Requirements changed. The previous plan approval is no longer valid; downstream work needs review. No engineering artifacts have been updated.</div>}
          <fieldset className="product-form" disabled={busy}>
          {step===0&&<>
            <label className="product-field"><span>Working name <small>Required for plan approval</small></span><input value={brief.name} onChange={e=>change('name',e.target.value)} maxLength={100} placeholder="Give your product a name"/></label>
            <label className="product-field"><span>What should it do? <small>Required for plan approval</small></span><textarea value={brief.description} onChange={e=>change('description',e.target.value)} maxLength={4000} rows={5} placeholder="Describe the thing you want to make, the problem it solves, and what success looks like."/></label>
            {field('audience')}
            <fieldset className="product-areas"><legend>What does it need? <small>Choose one or more</small></legend><div>{disciplines.map(d=><label key={d.id} className={has(d.id)?'selected':''}><input type="checkbox" checked={has(d.id)} onChange={e=>change('disciplines',e.target.checked?[...brief.disciplines,d.id]:brief.disciplines.filter(id=>id!==d.id))}/><span><b>{d.name}</b><small>{d.description}</small></span></label>)}</div></fieldset>
          </>}
          {step===1&&<>
            <label className="product-field"><span>First milestone</span><select value={brief.stage} onChange={e=>change('stage',e.target.value)}><option value="prototype">Working prototype</option><option value="pilot">Small pilot run</option><option value="production">Production candidate</option></select></label>
            {(has('electronics')||has('firmware'))&&field('power')}
            {(has('electronics')||has('firmware')||has('application'))&&field('connectivity',true)}
            {has('mechanical')&&field('dimensions',true)}
            {field('environment')}{field('budget')}{field('constraints',true)}
          </>}
          {step===2&&<>
            <div className="product-brief-summary"><span className="product-kicker">{brief.stage} / {brief.disciplines.map(id=>disciplines.find(d=>d.id===id).name).join(' + ')||'Choose work areas'}</span><h2>{brief.name||'Untitled product'}</h2><p>{brief.description||'Add a product description before approval.'}</p><details><summary>Review all requirements</summary><dl>{Object.keys(labels).map(key=><React.Fragment key={key}><dt>{labels[key]}</dt><dd>{brief[key]||'Not specified'}</dd></React.Fragment>)}</dl></details></div>
            <PlanTasks plan={plan}/>
            <div className="product-boundary"><ShieldCheck size={20}/><p>Approve the plan, not tool execution. Open decisions remain unresolved. No CAD edits, agent runs, hardware writes, purchases, or publishing are authorized here.</p></div>
            {problems.length>0&&<ul className="product-problems">{problems.map(p=><li key={p}>{p}</li>)}</ul>}
          </>}
          </fieldset>
          <div className="product-actions">
            {step>0&&<button className="product-button" disabled={busy} onClick={()=>setStep(step-1)}><ArrowLeft size={14}/>Back</button>}
            <button className="product-button" disabled={busy} onClick={()=>save()}>{busy?'Saving…':'Save draft'}</button>
            {step<2?<button className="product-button primary" disabled={busy} onClick={()=>save(step+1)}>Save &amp; continue<ArrowRight size={15}/></button>:<button className="product-button primary" disabled={busy||dirty||!record||problems.length>0} onClick={approve}>Approve plan &amp; open project<ArrowRight size={15}/></button>}
          </div>
          <p className="product-save-state">{dirty?'Unsaved changes. Save before switching products or approving the plan.':record?`Saved on this device · revision ${record.revision}`:'Nothing saved yet. You can save an incomplete draft.'}</p>
        </>:<>
          <div className="product-kicker">PRODUCT COMMAND CENTER / {brief.stage}</div><h1>{brief.name}</h1><p className="product-lead">{brief.description}</p>
          <div className="product-dashboard-stats"><div><b><Check size={17}/>Plan approved</b><span>Revision {record.revision} · sequence only</span></div><div><b>{plan.decisions.length} open decisions</b><span>No assumptions silently filled in</span></div><div><b>Work not started</b><span>Execution adapters are not wired here yet</span></div></div>
          <div className="product-next"><span className="product-kicker">NEXT STEP</span><h2>{plan.decisions.length?'Resolve the open requirements':'Review acceptance tests and technical approach'}</h2><p>{plan.decisions.length?'The build plan is agreed, but the design inputs below still need decisions.':'Filled fields are not yet a validated specification. Agree on measurable tests and verify the technical approach before design.'}</p><button className="product-button primary" onClick={()=>{setStep(1);setScreen('wizard');setNotice('Editing a saved requirement will invalidate plan approval.');}}>Review requirements<ArrowRight size={15}/></button></div>
          <div className="product-section-heading"><h2>Build sequence</h2><span className="product-tag">0 / {plan.tasks.length} executed</span></div><PlanTasks plan={plan}/>
          <div className="product-section-heading"><h2>Engineering tools</h2></div><div className="product-tool-grid">{disciplines.filter(d=>has(d.id)).map(d=><article key={d.id}><Layers size={18}/><h3>{d.name}</h3><p>{d.tool}</p><span>{d.id==='electronics'?'Existing workspace available; not linked to this brief.':'Adapter planned · not connected to this brief'}</span>{d.id==='electronics'&&<button className="product-button" onClick={onOpenElectronics}>Open electronics workspace<ArrowRight size={13}/></button>}</article>)}</div>
          <button className="product-button" onClick={()=>{setStep(0);setScreen('wizard');setNotice('Editing a saved requirement will invalidate plan approval.');}}>Edit product brief</button>
        </>}
        {record?.history.length>0&&<details className="product-history"><summary>Brief revision history ({record.history.length})</summary>{[...record.history].reverse().map(h=><article key={h.revision}><h3>Revision {h.revision} · {h.approvedAt?'plan was approved':'draft'}</h3><p>{h.brief.name}</p><pre>{JSON.stringify(h.brief,null,2)}</pre></article>)}</details>}
      </section>
      } secondary={<aside className="product-guide" aria-label="Build guide"><div className="product-guide-title"><Compass size={21}/><div><h2>Your build guide</h2><span>Local rules · no AI research has run</span></div></div>
        <div className="product-guide-message"><span className="product-kicker">THE PRODUCT COMES FIRST</span><h2>{screen==='dashboard'?'One plan. Every discipline.':step===0?'Tell me about the thing, not the tool.':step===1?'Unknown is a useful answer.':'Make the dependencies visible.'}</h2><p>{screen==='dashboard'?'This is where Benchline will coordinate the work and surface the decisions that need you. This preview records your brief and approved sequence; it does not dispatch or track engineering jobs yet.':step===0?'A circuit board might be one part of the answer. Start with what you want to make—we’ll organize electronics, firmware, enclosure, and application work around that.':step===1?'You don’t need every answer to begin. Missing information stays on the decision list, so it can be resolved before dependent work starts.':'The proposed sequence is based on the work areas you selected. It is not an engineering assessment, researched component shortlist, or feasibility sign-off.'}</p></div>
        {brief.disciplines.length>0&&<section><h3><GitBranch size={15}/>Proposed approach</h3><ul className="product-approach">{plan.approach.map(text=><li key={text}>{text}</li>)}</ul></section>}
        <section><h3><Circle size={13}/>Open decisions <span>{plan.decisions.length}</span></h3><div className="product-decisions">{plan.decisions.map(d=><article key={d.field}><b>{d.label}</b><p>{d.reason}</p></article>)}{plan.decisions.length===0&&<p>No blank intake fields flagged. Technical validation and measurable acceptance tests are still required.</p>}</div></section>
        <div className="product-guide-foot"><ShieldCheck size={17}/><p>Briefs are stored locally in this workspace. Engineering files and remembered tool permissions remain separate.</p></div>
        <button className="product-button" onClick={onOpenElectronics}>Already have a board? Open electronics workspace<ArrowRight size={14}/></button>
      </aside>}/>
    </div>
  </main>;
}
