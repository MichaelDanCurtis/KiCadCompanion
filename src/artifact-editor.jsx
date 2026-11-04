import React,{useEffect,useRef,useState} from 'react';

export function ArtifactEditor({project,artifact,canControl,controllerToken}){
  const [capabilities,setCapabilities]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const alive=useRef(false),inFlight=useRef(false);
  useEffect(()=>{alive.current=true;const abort=new AbortController();fetch('/api/artifact-editors/capabilities',{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error('Editor availability could not be checked');return r.json();}).then(value=>{if(alive.current)setCapabilities(value);}).catch(e=>{if(alive.current&&e.name!=='AbortError')setError(e.message);});return()=>{alive.current=false;abort.abort();};},[]);
  async function open(){
    if(!canControl||inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setMessage('');
    try{const r=await fetch(`/api/artifact-editors/${project.manifest.id}/${artifact.id}/open`,{method:'POST',headers:{'Content-Type':'application/json','X-Benchline-Controller':controllerToken},body:JSON.stringify({requestId:crypto.randomUUID(),expectedManifestHash:project.hash,expectedEpoch:project.local.epoch,expectedSavedHash:project.local.observations[artifact.id]?.saved.hash})});const result=await r.json();if(!r.ok)throw Error(result.error||'Editor opening failed');if(alive.current)setMessage(result.detail);}
    catch(e){if(alive.current)setError(e.message);}finally{inFlight.current=false;if(alive.current)setBusy(false);}
  }
  return <section aria-label="Selected artifact editor"><button className="product-button" type="button" onClick={open} disabled={!canControl||busy||!capabilities?.pcb.supported||project.local.observations[artifact.id]?.saved.status!=='saved'}>{busy?'Requesting editor…':'Open selected PCB in KiCad'}</button>
    <p>{capabilities?.pcb.reason||capabilities?.scope||'Checking the configured editor…'}</p>{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
