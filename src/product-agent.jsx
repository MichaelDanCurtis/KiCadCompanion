import {ArtifactContext} from './artifact-workbench.jsx';
import React, {useEffect, useRef, useState} from 'react';

async function providerRequest(path = '', body, signal, controllerToken) {
  const response = await fetch(`/api/provider/product${path}`, body === undefined ? {signal} :
    {method: 'POST', headers: {'Content-Type': 'application/json', ...(controllerToken ? {'X-Benchline-Controller':controllerToken} : {})}, body: JSON.stringify(body), signal});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Product agent request failed');
  return data;
}

// Parent keys this component by project/manifest/epoch. Native selection and
// permission controls remain host-owned; the transcript is plain text, not HTML.
export function ProductAgent({project, controllerToken, readOnly = false, selectedArtifactId = null, initialDraft = '', onDraft = () => {}}) {
  const request=(path,body,signal)=>providerRequest(path,body,signal,controllerToken);
  const [mode, setMode] = useState('discuss'), [documents, setDocuments] = useState([]);
  const [capabilities, setCapabilities] = useState(null), [status, setStatus] = useState(null);
  const [text, setText] = useState(initialDraft), [messages, setMessages] = useState([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [opening, setOpening] = useState(false);
  const [sending, setSending] = useState(false);
  const alive = useRef(false), owner = useRef(null), pending = useRef(null), running = useRef(false);
  const m = project.manifest;
  const supported = capabilities?.modes?.[mode]?.supported === true;
  const connected = Boolean(owner.current && status?.selectionId === owner.current);
  useEffect(() => {
    alive.current = true; const abort = new AbortController();
    Promise.all([request('/capabilities', undefined, abort.signal), request('', undefined, abort.signal)])
      .then(([caps, state]) => {if (alive.current) {setCapabilities(caps); setStatus(state);}})
      .catch(e => {if (alive.current && e.name !== 'AbortError') setError(e.message);});
    return () => {
      alive.current = false; abort.abort(); pending.current?.abort();
      const selectionId = owner.current; owner.current = null;
      if (selectionId) request('/disconnect', {selectionId}).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!connected) return;
    let stopped = false, timer; const abort = new AbortController();
    async function refresh() {
      try {
        const next = await request('', undefined, abort.signal);
        if (stopped) return;
        setStatus(next);
        if (next.selectionId !== owner.current) {
          owner.current = null; setMessages([]); setError('The agent selection changed in another window. Reconnect deliberately.'); return;
        }
        const transcript = await request(`/transcript/${owner.current}`, undefined, abort.signal);
        if (!stopped) setMessages(transcript.messages);
      } catch (e) {if (!stopped && e.name !== 'AbortError') {setError(e.message); setStatus(null);}}
      if (!stopped) timer = setTimeout(refresh, 1000);
    }
    refresh();
    return () => {stopped = true; clearTimeout(timer); abort.abort();};
  }, [connected]);
  async function perform(action) {
    if (running.current || readOnly) return;
    running.current = true; setBusy(true); setError('');
    try {await action();}
    catch (e) {if (alive.current && e.name !== 'AbortError') setError(e.message + ' Do not resend an uncertain action blindly.');}
    finally {running.current = false; if (alive.current) setBusy(false);}
  }
  async function connect() {
    await perform(async () => {
      const abort = new AbortController(); pending.current = abort; setOpening(true);
      try {
        const selected = await request('/select', {projectId: m.id, documentIds: documents, mode,
          expectedManifestHash: project.hash, expectedEpoch: project.local.epoch}, abort.signal);
        if (!alive.current || abort.signal.aborted) {await request('/disconnect', {selectionId: selected.selectionId}); return;}
        owner.current = selected.selectionId; setStatus(selected); setMessages([]);
      } finally {if (pending.current === abort) pending.current = null; if (alive.current) setOpening(false);}
    });
  }
  async function disconnect() {
    await perform(async () => {
      const selectionId = owner.current;
      const next = await request('/disconnect', {selectionId});
      if (alive.current) {owner.current = null; setStatus(next); setMessages([]);}
    });
  }
  const editableScope = !readOnly && !busy && !owner.current;
  return <section className="product-agent" aria-label="Product agent">
    <div className="product-agent-scope">
      <h2>Agent scope</h2><p>{m.name} · manifest revision {m.revision}</p>
      <label className="product-field">Execution mode<select aria-label="Product agent mode" value={mode} disabled={!editableScope} onChange={e => setMode(e.target.value)}><option value="discuss">Discuss · read only</option><option value="agent">Agent · reviewed actions</option></select></label>
      <fieldset disabled={!editableScope}><legend>Documents this session may address</legend>
        {!m.artifacts.length ? <p>Register a native file above before selecting an engineering scope.</p> : m.artifacts.map(a => <label key={a.id}><input type="checkbox" checked={documents.includes(a.id)} onChange={e => setDocuments(ids => e.target.checked ? [...ids, a.id] : ids.filter(id => id !== a.id))}/>{a.name} · {a.kind}</label>)}
      </fieldset>
      <p>{supported ? 'This mode is available. Individual tool capabilities and approvals still apply.' : capabilities?.modes?.[mode]?.reason || 'Checking provider capabilities…'}</p>
      <button className="product-button" disabled={readOnly || busy || !supported || !documents.length || Boolean(owner.current)} onClick={connect}>Connect selected product</button>
      <button className="product-button" disabled={busy} onClick={() => perform(async () => {
        const [caps, next] = await Promise.all([request('/capabilities'), request('')]);
        if (alive.current) {setCapabilities(caps); setStatus(next);}
      })}>Refresh agent status</button>
      {opening ? <button className="product-button" onClick={() => pending.current?.abort()}>Cancel opening</button> : null}
      {owner.current ? <button className="product-button" disabled={busy} onClick={disconnect}>Disconnect product agent</button> : null}
      <p>Changing product or manifest closes this panel’s session. No global permissions or conversation are adopted. Disconnect stops future work; it does not undo applied changes.</p>
    </div>
    <div className="product-agent-conversation">
      <h2>Build with Benchline</h2>
      <p role="status">{opening ? 'Opening selected product…' : connected ? `Product agent: ${status.phase}` : 'No agent session owned by this panel.'}</p>
      {error ? <p className="product-alert" role="alert">{error}</p> : null}
      <div className="product-agent-messages" role="log" aria-label="Product agent conversation">
        {!messages.length ? <p>No model conversation has run for this selection. Account sign-in alone does not enable engineering actions.</p> : messages.map(message => <article key={`${message.turnId}-${message.role}-${message.id}`}><h3>{message.role === 'user' ? 'You' : 'Benchline'}</h3><p>{message.text}</p>{message.truncated ? <p>Display limit reached; text is truncated.</p> : null}</article>)}
      </div>
      <ArtifactContext compact artifact={m.artifacts.find(a=>a.id===selectedArtifactId)} observation={project.local.observations?.[selectedArtifactId]} impact={project.impact}/>
      <form onSubmit={e => {e.preventDefault(); perform(async () => {
        const sent = text; setSending(true);
        try {
          await request('/turn', {selectionId: owner.current, text: sent});
          if (alive.current) {setText(''); onDraft('');}
        } finally {if (alive.current) setSending(false);}
      });}}>
        <label className="product-field">What should we work on?<textarea aria-label="Product agent message" value={text} disabled={readOnly || sending} onChange={e => {setText(e.target.value); onDraft(e.target.value);}} maxLength={16000} placeholder="Describe the next step for this product…"/></label>
        <button type="submit" className="product-button primary" disabled={readOnly || busy || !supported || !connected || status?.phase !== 'ready' || !text.trim()}>Send to product agent</button>
        <button type="button" className="product-button" disabled={readOnly || !connected || (!sending && !['working', 'starting'].includes(status?.phase))} onClick={() => request('/stop', {selectionId: owner.current}).catch(e => {if (alive.current) setError(e.message);})}>Stop future work</button>
      </form>
      <p>Review proposed actions and Allow once / Decline / scoped Always allow decisions in Action controls below. Assistant text is not execution evidence. Transcript is bounded and session-local; disconnect clears it.</p>
    </div>
  </section>;
}
