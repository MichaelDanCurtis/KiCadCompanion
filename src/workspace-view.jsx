import React,{useEffect,useRef,useState} from 'react';

const tokenKey=id=>`benchline.window-controller.v1:${id}`;
const claimKey=id=>`benchline.window-claim.v1:${id}`;
export function controllerHeaders(projectId) {
  try {const token=sessionStorage.getItem(tokenKey(projectId));return token?{'X-Benchline-Controller':token}:{};} catch{return {};}
}
async function request(path,body,projectId,signal,token,claimNonce) {
  const response=await fetch(`/api/workspace-views${path}`,{method:body===undefined?'GET':'POST',signal,cache:'no-store',
    headers:{'Content-Type':'application/json',...(projectId?controllerHeaders(projectId):{}),...(token?{'X-Benchline-Controller':token}:{}),...(claimNonce?{'X-Benchline-Claim':claimNonce}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();if(!response.ok)throw Error(value.error||'Workspace view unavailable');return value;
}

export function useWorkspaceView(project) {
  const [view,setView]=useState(null),[error,setError]=useState(''),[joining,setJoining]=useState(false);
  const generation=useRef(0),alive=useRef(false);
  const claims=useRef(new Map());
  const projectId=project?.manifest.id;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  async function join(signal) {
    if(!project)return;
    const version=++generation.current;setJoining(true);setError('');
    try {
      let claimNonce=claims.current.get(projectId);
      if(!claimNonce){try{claimNonce=sessionStorage.getItem(claimKey(projectId));}catch{}}
      if(!/^[a-f0-9]{64}$/.test(claimNonce||''))claimNonce=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      claims.current.set(projectId,claimNonce);
      // Save a private retry nonce BEFORE joining. An aborted first response or
      // Strict Mode remount can recover that same claim without a second owner.
      try{sessionStorage.setItem(claimKey(projectId),claimNonce);}catch{}
      const next=await request('/join',{projectId,expectedManifestHash:project.hash,expectedEpoch:project.local.epoch},projectId,signal,undefined,claimNonce);
      if(!alive.current || version!==generation.current)return;
      if(next.controllerToken) {
        // Session storage belongs only to this tab. Detached windows use noopener
        // and never receive controller tokens in a URL, event or shared storage.
        try {sessionStorage.setItem(tokenKey(projectId),next.controllerToken);}
        catch {setError('Control cannot be retained in this tab. Release control before closing this window.');}
      }
      setView(next);
    }catch(e){if(alive.current&&version===generation.current&&e.name!=='AbortError'){setView(null);setError(e.message);}}
    finally{if(alive.current&&version===generation.current)setJoining(false);}
  }
  useEffect(()=>{
    setView(null);const abort=new AbortController();join(abort.signal);
    return()=>{abort.abort();generation.current++;};
  },[projectId,project?.hash,project?.local.epoch]);
  useEffect(()=>{
    if(!view?.viewId)return;
    const viewId=view.viewId;let stopped=false,timer;const abort=new AbortController();
    async function poll(){
      try {
        const next=await request(`/${viewId}`,undefined,undefined,abort.signal);
        if(!stopped)setView(current=>current?.viewId===viewId?{...current,...next}:current);
      }catch(e){if(!stopped&&e.name!=='AbortError'){setError(e.message);setView(current=>current?.viewId===viewId?{...current,phase:'unavailable'}:current);}}
      if(!stopped)timer=setTimeout(poll,2000);
    }
    poll();return()=>{stopped=true;clearTimeout(timer);abort.abort();};
  },[view?.viewId]);
  async function select(artifactId) {
    if(!view)return;
    try {const next=await request(`/${view.viewId}/selection`,{artifactId,expectedRevision:view.revision});
      if(alive.current)setView(current=>current?.viewId===next.viewId?{...current,...next}:current);
    }catch(e){if(alive.current)setError(e.message);}
  }
  async function release(){
    if(!view)return;
    setJoining(true);setError('');
    try {
      await request(`/${view.viewId}/release`,{},projectId,undefined,view.controllerToken);
      try {sessionStorage.removeItem(tokenKey(projectId));}catch{}
      if(alive.current)setView(null);
    }catch(e){if(alive.current)setError(e.message);}
    finally{if(alive.current)setJoining(false);}
  }
  const current=Boolean(view && projectId && view.projectId===projectId);
  const stale=current&&view.project&&(view.project.hash!==project.hash||view.project.local.epoch!==project.local.epoch);
  return {view:current?view:null,error,joining,join,release,select,stale,
    canControl:Boolean(current&&view.role==='controller'&&view.phase==='ready'&&!joining&&!stale),
    controllerToken:current?view.controllerToken:undefined};
}

export function WorkspaceViewControls({control}) {
  const {view,joining,canControl,error,stale}=control;
  return <section className="workspace-view-controls" aria-label="Window control">
    <p role="status">{joining?'Opening workspace control…':canControl?'This window controls this project.':view?'Review window — another window controls this project.':'No workspace controller connected.'}</p>
    {error&&<p role="alert">{error}</p>}
    {stale&&<p role="alert">Project changed elsewhere. Refresh the saved project before making another change; unsaved form inputs remain here.</p>}
    {view&&<button type="button" className="product-button" onClick={()=>{
      window.open(`/?review=${encodeURIComponent(view.viewId)}`,'_blank','noopener,noreferrer,width=720,height=900');
    }}>Detach review &amp; AI</button>}
    {canControl&&<button type="button" className="product-button" onClick={control.release}>Release window control</button>}
    {!canControl&&<button type="button" className="product-button" disabled={joining} onClick={()=>control.join()}>Reconnect workspace view</button>}
    {view&&!canControl&&<p>Release control in the controlling window before claiming it here. Reloading that same tab retains its control; a detached review never inherits it.</p>}
  </section>;
}
