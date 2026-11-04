import React, {useEffect, useRef, useState} from 'react';

async function request(path = '', body, signal) {
  const response = await fetch(`/api/provider/account${path}`, body === undefined ? {signal} :
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Account setup request failed');
  return result;
}
export function ProviderAccountSetup() {
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [consent, setConsent] = useState(false), [login, setLogin] = useState(null);
  const alive = useRef(false), running = useRef(false);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    request('', undefined, controller.signal).then(value => {if (alive.current) setStatus(value);})
      .catch(e => {if (e.name !== 'AbortError' && alive.current) setError(e.message);});
    return () => {alive.current = false; controller.abort();};
  }, []);
  async function perform(path, body = {}) {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      const result = await request(path, body);
      if (!alive.current) return;
      if (path === '/login') setLogin(result);
      else if (['/cancel', '/logout', '/disconnect'].includes(path)) setLogin(null);
      const next = await request('');
      if (alive.current) {setStatus(next); if (!next.loginPending) setLogin(null);}
    } catch (e) {if (alive.current) {setError(e.message); setLogin(null); setStatus(null);}}
    finally {running.current = false; if (alive.current) setBusy(false);}
  }
  const connected = status && !['disconnected', 'error'].includes(status.phase);
  const label = !status ? 'Status unavailable' : status.signedIn === true ? 'Signed in to Benchline’s profile' :
    status.phase === 'awaiting-sign-in' ? 'Waiting for your sign-in' : status.signedIn === false ? 'Not signed in' : status.phase.replaceAll('-', ' ');
  return <details className="provider-account product-history">
    <summary>AI account setup · {label}</summary>
    <p>Benchline uses its own local Codex profile. No global credentials, remembered permissions, plugins, or customer files are imported. Signing in does not enable AI engineering actions yet.</p>
    <p role="status">{busy ? 'Working on account setup…' : label} · Model execution remains paused.</p>
    {error ? <p className="product-alert" role="alert">{error}</p> : null}
    <label><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)}/> I want to set up a separate Benchline account profile.</label>
    <div className="provider-account-buttons">
      <button className="product-button" disabled={busy || !consent || connected} onClick={() => perform('/prepare', {confirm: true})}>Prepare isolated account setup</button>
      <button className="product-button primary" disabled={busy || !consent || !connected || status?.signedIn !== false || status?.loginPending} onClick={() => perform('/login', {confirm: true})}>Start ChatGPT sign-in</button>
      <button className="product-button" disabled={busy || !connected} onClick={() => perform('/refresh')}>Check sign-in status</button>
      <button className="product-button" disabled={busy || !status?.loginPending} onClick={() => perform('/cancel')}>Cancel sign-in</button>
      <button className="product-button" disabled={busy || status?.signedIn !== true} onClick={() => perform('/logout', {confirm: true})}>Sign out of Benchline</button>
      <button className="product-button" disabled={busy || !connected} onClick={() => perform('/disconnect')}>Disconnect setup</button>
    </div>
    {login ? <p><a className="product-button primary" href={login.authUrl} target="_blank" rel="noopener noreferrer">Continue on the official ChatGPT sign-in page</a> Then return here and choose Check sign-in status. This link is not saved to your project.</p> : null}
    <p>Disconnect stops this setup connection; it does not sign out or delete the profile. Sign out affects only Benchline’s profile, not the Codex app.</p>
  </details>;
}
