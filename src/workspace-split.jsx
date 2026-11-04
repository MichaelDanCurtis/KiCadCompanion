import React, {useEffect, useId, useRef, useState} from 'react';
import {defaultLayout, layoutBounds, layoutStorageKey, normalizeLayout} from '../shared/workspace-layout.mjs';
import './workspace-split.css';

export function WorkspaceSplit(props) {
  return <ScopedSplit key={props.scope} {...props}/>;
}

function ScopedSplit({scope, primary, secondary, primaryLabel = 'Workspace', secondaryLabel = 'AI & approvals'}) {
  const storageKey = layoutStorageKey(scope), id = useId(), grid = useRef(null);
  const [layout, setLayout] = useState(() => {
    try {return normalizeLayout(JSON.parse(localStorage.getItem(storageKey)));}
    catch {return {...defaultLayout};}
  });
  const [storageError, setStorageError] = useState('');
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches);
  const [tab, setTab] = useState(layout.collapsed === 'primary' ? 'secondary' : 'primary');
  const drag = useRef(null);
  useEffect(() => {
    const media = matchMedia('(max-width: 900px)');
    const change = () => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  function update(change) {
    const next = normalizeLayout({...layout, ...change});
    setLayout(next);
    try {localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError('');}
    catch {setStorageError('Layout changed for this window, but could not be saved in this browser.');}
  }
  function resize(event) {
    if (drag.current !== event.pointerId || !grid.current) return;
    const bounds = grid.current.getBoundingClientRect();
    update({primary: (event.clientX - bounds.left) / bounds.width * 100});
  }
  function keyboard(event) {
    const step = event.shiftKey ? 10 : 2;
    const values = {ArrowLeft: layout.primary - step, ArrowRight: layout.primary + step,
      Home: layoutBounds.min, End: layoutBounds.max};
    if (event.key in values) {event.preventDefault(); update({primary: values[event.key]});}
  }
  const primaryHidden = narrow ? tab !== 'primary' : layout.collapsed === 'primary';
  const secondaryHidden = narrow ? tab !== 'secondary' : layout.collapsed === 'secondary';
  return <section className="workspace-split" aria-label={`${primaryLabel} and ${secondaryLabel}`}>
    <div className="split-toolbar">
      {narrow ? <div role="tablist" aria-label="Workspace panes">
        {['primary', 'secondary'].map(side => <button key={side} id={`${id}-${side}-tab`} type="button" role="tab"
          aria-selected={tab === side} aria-controls={`${id}-${side}`} tabIndex={tab === side ? 0 : -1}
          onClick={() => setTab(side)} onKeyDown={event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 'primary' : event.key === 'End' ? 'secondary' : tab === 'primary' ? 'secondary' : 'primary';
              setTab(next); document.getElementById(`${id}-${next}-tab`)?.focus();
            }
          }}>{side === 'primary' ? primaryLabel : secondaryLabel}</button>)}
      </div> : <div className="split-collapse-controls">
        <button type="button" aria-expanded={!primaryHidden} aria-controls={`${id}-primary`}
          onClick={() => update({collapsed: primaryHidden ? null : 'primary'})}>{primaryHidden ? 'Show' : 'Collapse'} {primaryLabel}</button>
        <button type="button" aria-expanded={!secondaryHidden} aria-controls={`${id}-secondary`}
          onClick={() => update({collapsed: secondaryHidden ? null : 'secondary'})}>{secondaryHidden ? 'Show' : 'Collapse'} {secondaryLabel}</button>
      </div>}
      <button type="button" onClick={() => {update(defaultLayout); setTab('primary');}}>Reset layout</button>
    </div>
    {storageError && <p role="status">{storageError}</p>}
    <div className="split-grid" ref={grid} data-single={primaryHidden || secondaryHidden}
      style={{gridTemplateColumns: primaryHidden || secondaryHidden ? 'minmax(0, 1fr)' : `minmax(0, ${layout.primary}fr) 12px minmax(0, ${100-layout.primary}fr)`}}>
      <div id={`${id}-primary`} className="split-pane split-primary" hidden={primaryHidden}
        role={narrow ? 'tabpanel' : 'region'} aria-label={primaryLabel}>{primary}</div>
      {!primaryHidden && !secondaryHidden && <div className="split-handle" role="separator" tabIndex={0}
        aria-label={`${primaryLabel} width`} aria-orientation="vertical" aria-controls={`${id}-primary`}
        aria-valuemin={layoutBounds.min} aria-valuemax={layoutBounds.max} aria-valuenow={Math.round(layout.primary)}
        aria-valuetext={`${Math.round(layout.primary)} percent for ${primaryLabel}`}
        onKeyDown={keyboard} onPointerDown={event => {
          if (event.button !== 0) return;
          drag.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus();
        }} onPointerMove={resize} onPointerUp={event => {
          if (drag.current !== event.pointerId) return;
          resize(event); drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={() => {drag.current = null;}} onLostPointerCapture={() => {drag.current = null;}}/>}
      <div id={`${id}-secondary`} className="split-pane split-secondary" hidden={secondaryHidden}
        role={narrow ? 'tabpanel' : 'region'} aria-label={secondaryLabel}>{secondary}</div>
    </div>
  </section>;
}
