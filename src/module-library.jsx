import React,{useEffect,useRef,useState} from 'react';
import {moduleFacts,exportBom,moduleImportMaxBytes,bomWithSourcingObservation} from '../shared/modules.mjs';
import {controllerHeaders} from './workspace-view.jsx';

function labelFor(pkg,path){
  const labels={vendor:'Manufacturer',model:'Model',hardwareRevision:'Hardware revision',pinInventoryComplete:'Complete pin inventory',
    minSupplyV:'Minimum supply',maxSupplyV:'Maximum supply',maxCurrentMA:'Maximum current',maxVoltageV:'Maximum voltage',
    widthMM:'Width',heightMM:'Height',depthMM:'Depth',name:'Name',interfaces:'Interfaces',reserved:'Reserved',sdk:'SDK',version:'Version'};
  const parts=path.split('.'),name=labels[parts.at(-1)]||path;
  return parts[0]==='pins'?`Pin ${pkg.pins.find(p=>p.id===parts[1])?.number} — ${name}`:parts[0]==='firmware'?`Firmware — ${name}`:name;
}
function display(fact){return fact.value===null?'Unknown':`${Array.isArray(fact.value)?fact.value.join(', '):String(fact.value)}${fact.unit?' '+fact.unit:''}`;}
function unresolvedSourceRevision(pkg,fact){return fact.sources.some(ref=>['conflicting','unreviewed'].includes(pkg.sources.find(s=>s.id===ref.sourceId)?.revisionStatus));}
function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function ModuleLibrary({project,canControl,controllerToken}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState(null),[note,setNote]=useState('');
  const projectId=project.manifest.id;
  const requestVersion=useRef(0);
  const request=async(path='',body)=>{
    const response=await fetch(`/api/module-library/projects/${projectId}${path}`,body?{method:'POST',headers:{'Content-Type':'application/json',...controllerHeaders(projectId),...(controllerToken?{'X-Benchline-Controller':controllerToken}:{})},body:JSON.stringify(body)}:{});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Module library request failed');return result;
  };
  useEffect(()=>{let active=true;const version=requestVersion.current;request().then(result=>{if(active&&version===requestVersion.current)setData(result);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[projectId]);
  const perform=async(path,body)=>{if(!canControl||busy)return;requestVersion.current++;setBusy(true);setError('');try{await request(path,{expectedHash:project.hash,...body});setData(await request());setReview(null);setNote('');}catch(e){setError(e.message);}finally{setBusy(false);}};
  const importFile=async(event,kind)=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try{if(file.size>moduleImportMaxBytes)throw Error('This preview accepts JSON files up to 512 KiB.');const value=JSON.parse(await file.text());await perform(kind==='package'?'/packages':'/boms',{[kind]:value});}
    catch(e){setError(e.message);}
  };
  const refresh=async()=>{setBusy(true);setError('');try{setData(await request());}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <section className="module-library" aria-label="Module packages and BOM">
    <h3>Module packages and BOM</h3>
    <p>Import a package for the exact manufacturer, model and hardware revision. Imported facts start as proposals; missing or conflicting critical facts block dependent design work.</p>
    <p>{data?.liveRetrieval.reason||'Live manufacturer and distributor retrieval is not configured.'}</p>
    <fieldset disabled={!canControl||busy}><legend>Import local data for review</legend>
      <label className="product-field">Module package JSON<input type="file" accept=".json,application/json" aria-label="Import module package JSON" onChange={e=>importFile(e,'package')}/></label>
      <label className="product-field">BOM JSON<input type="file" accept=".json,application/json" aria-label="Import BOM JSON" onChange={e=>importFile(e,'bom')}/></label>
    </fieldset>
    <button className="product-button" disabled={busy} onClick={refresh}>Refresh module library</button>
    {error&&<p role="alert" className="product-alert">{error}</p>}
    {data&&!data.packages.length&&<p>No module package imported. The pilot module has not been selected.</p>}
    {data?.packages.map(record=><article key={record.id} className="module-package" data-record-id={record.id}>
      <h4>{record.package.identity.vendor.value||'Unknown manufacturer'} · {record.package.identity.model.value||'Unknown model'}</h4>
      <p>Hardware revision: {display(record.package.identity.hardwareRevision)} · Review revision {record.revision}</p>
      <p className="product-alert">{record.readiness.ready?'Referenced facts reviewed. Native actions and asset reuse still require their own approval.':`${record.readiness.blockers.length} unresolved checks — dependent design work is blocked.`}</p>
      {record.parentId&&<p>This is a separate candidate. The previous module record remains unchanged.</p>}
      <button className="product-button" onClick={()=>download(`module-${record.package.id}.json`,JSON.stringify(record.package,null,2)+'\n')}>Export module package JSON</button>
      <details><summary>Unresolved checks</summary><ul>{record.readiness.blockers.map((reason,i)=><li key={i}>{reason}</li>)}</ul></details>
      <details><summary>Review facts ({moduleFacts(record.package).length})</summary>
        <ul className="module-facts">{moduleFacts(record.package).map(([path,fact])=><li key={path}>
          <strong>{labelFor(record.package,path)}</strong><span>{display(fact)}</span><span className="product-tag">{fact.status.replaceAll('-',' ')}</span>
          <button className="product-button" disabled={!canControl||busy} onClick={()=>{setReview({recordId:record.id,path});setNote('');}}>Review {labelFor(record.package,path)}</button>
          {review?.recordId===record.id&&review.path===path&&<div className="module-fact-review">
            {!fact.sources.length&&<p>No source is recorded. This fact cannot be confirmed.</p>}
            {unresolvedSourceRevision(record.package,fact)&&<p>A source revision is conflicting or unreviewed. This fact needs a separate sourced proposal before confirmation.</p>}
            {fact.sources.map((ref,i)=>{const source=record.package.sources.find(s=>s.id===ref.sourceId);return <p key={i}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> · {ref.locator} · version {source.version||'unknown'} · retrieved {source.retrievedAt||'unknown'}<br/>Source hash: <code>{source.sha256||'unknown'}</code></p>;})}
            <label className="product-field">Review note<textarea aria-label={`Review note for ${labelFor(record.package,path)}`} value={note} onChange={e=>setNote(e.target.value)} maxLength={2000}/></label>
            <button className="product-button" disabled={busy||note.trim().length<4||['unknown','conflicting'].includes(fact.status)||unresolvedSourceRevision(record.package,fact)} onClick={()=>perform(`/packages/${record.id}/review`,{expectedRevision:record.revision,expectedSha256:record.sha256,field:path,decision:'confirm',note})}>Confirm this fact from its source</button>
            <button className="product-button" disabled={busy||note.trim().length<4} onClick={()=>perform(`/packages/${record.id}/review`,{expectedRevision:record.revision,expectedSha256:record.sha256,field:path,decision:'unknown',note})}>Mark this fact unknown</button>
          </div>}
        </li>)}</ul>
      </details>
      <details><summary>Source and asset references</summary><ul>{record.package.sources.map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> · {source.version||'version unknown'} · {source.license||'license unknown'}
        {source.revisionStatus&&<span className="product-tag">Source revision: {source.revisionStatus}</span>}
        <button className="product-button" disabled={!canControl||busy||!record.retrievableSourceIds?.includes(source.id)} onClick={()=>perform(`/packages/${record.id}/sources/retrieve`,{
          requestId:crypto.randomUUID(),sourceId:source.id,expectedRevision:record.revision,expectedSha256:record.sha256,
        })}>Check source: {source.title}</button>
      </li>)}</ul>
        <ul>{record.package.assets.map(asset=><li key={asset.id}>{asset.name} · {asset.kind} · {asset.reuseStatus.replaceAll('-',' ')} · {asset.license||'license unknown'}</li>)}</ul>
        <p>References are not downloaded or installed as native assets.</p>
      </details>
      {!!record.retrievals?.length&&<details><summary>Source check history ({record.retrievals.length})</summary>
        <p>Checks preserve source observations separately. Engineering facts and their confirmations remain unchanged.</p>
        {record.retrievals.map(receipt=><section key={receipt.requestId}>
          <p>{record.package.sources.find(s=>s.id===receipt.sourceId)?.title} · {receipt.observation.observedAt} · {receipt.observation.status}</p>
          <p>{receipt.observation.reason}</p>
          {receipt.observation.sha256&&<p>{receipt.observation.sha256===receipt.priorSourceHash?'Matches the recorded source hash.':'Source content differs or the prior hash is unknown; review a separate proposal.'}<br/>Content hash: <code>{receipt.observation.sha256}</code></p>}
          {receipt.observation.excerpt&&<details><summary>Untrusted source excerpt{receipt.observation.excerptTruncated?' (truncated)':''}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{receipt.observation.excerpt}</pre></details>}
        </section>)}
      </details>}
      {record.package.notes&&<details><summary>Imported notes (untrusted source text)</summary><p className="module-imported-notes">{record.package.notes}</p></details>}
      <details><summary>Review history ({record.events.length})</summary><ul>{record.events.map((event,i)=><li key={i}>{event.kind.replaceAll('-',' ')} · {event.at} · {event.note}</li>)}</ul></details>
    </article>)}
    {data&&!data.boms.length&&<p>No BOM imported.</p>}
    <p>{data?.distributor?.reason||'DigiKey API access is not configured.'}</p>
    {data?.boms.map(record=><article key={record.id} className="module-package" data-bom-id={record.id}>
      <h4>{record.bom.name} · revision {record.bom.revision}</h4>
      <button className="product-button" onClick={()=>download(`bom-${record.bom.id}.json`,exportBom(record.bom))}>Export BOM JSON</button>
      {!!record.unresolvedModuleReferences.length&&<p className="product-alert">{record.unresolvedModuleReferences.length} module references are missing or stale. Importing this BOM did not replace or approve a module.</p>}
      {record.bom.items.map(item=><section key={item.id}><h4>{item.references.join(', ')} · {item.manufacturer} {item.mpn}</h4><p>Quantity {item.quantity} · {item.packaging} · {item.dnp?'Do not populate':'Populate'}</p>
        <button className="product-button" disabled={!canControl||busy||!record.retrievableItemIds?.includes(item.id)} onClick={()=>perform(`/boms/${record.id}/sourcing/retrieve`,{
          requestId:crypto.randomUUID(),itemId:item.id,expectedBomRevision:record.bom.revision,expectedBomSha256:record.sha256,
        })}>Check DigiKey sourcing: {item.references.join(', ')}</button>
        {record.sourcing?.filter(s=>s.itemId===item.id).map(receipt=><section key={receipt.requestId} aria-label={`DigiKey observation for ${item.references.join(', ')}`}>
          <p>DigiKey · {receipt.observation.status} · {receipt.observation.observedAt}</p><p>{receipt.observation.reason}</p>
          {receipt.observation.offer&&<><p>{receipt.observation.offer.sku} · {receipt.observation.offer.packaging} · {receipt.observation.offer.unitPrice??'Price unknown'} {receipt.observation.offer.currency} per unit · quantity {receipt.observation.offer.requestedQuantity} · stock {receipt.observation.offer.availableQuantity??'unknown'}</p>
            <p>This observation has not changed the BOM. Review the exported proposal before importing it.</p>
            <button className="product-button" onClick={()=>{try{download(`bom-sourcing-${record.bom.id}.json`,exportBom(bomWithSourcingObservation(record.bom,item.id,receipt.observation.offer)));}catch(e){setError(e.message);}}}>Export BOM proposal with this observation</button></>}
        </section>)}
        <p>Saved sourcing observations; current availability and electrical suitability are not established.</p>
        <ul>{record.comparison.find(c=>c.itemId===item.id).offers.map(offer=><li key={offer.id}>{offer.distributor} · {offer.sku} · {offer.packaging} · {offer.unitPrice===null?'Price unknown':`${offer.unitPrice} ${offer.currency} per unit`} · quoted for {offer.requestedQuantity} · stock {offer.availableQuantity??'unknown'} · {offer.observedAt}
          {offer.substitute&&' · Proposed substitute only'} · <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a></li>)}</ul>
        {!!item.proposedSubstitutes.length&&<details><summary>Proposed substitutes — no automatic replacements</summary><ul>{item.proposedSubstitutes.map((sub,i)=><li key={i}>{sub.manufacturer} {sub.mpn} — {sub.reason}</li>)}</ul></details>}
      </section>)}
    </article>)}
  </section>;
}
