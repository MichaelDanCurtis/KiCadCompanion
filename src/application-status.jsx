import React from 'react';
import pendingProtocol from '../docs/benchline/application/ESP32-S3-EYE-v2.2-protocol.pending.json' with {type:'json'};
import {validateApplicationProtocol} from '../shared/application-protocol.mjs';

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
export function ApplicationStatusPanel(){
  const validation=validateApplicationProtocol(pendingProtocol,{expectedTarget:target});
  return <section className="application-status" aria-label="Application readiness">
    <h3>Application readiness</h3><p>Selected target: <strong>{target.model} {target.hardwareRevision}</strong>. The shared protocol is checked before a frontend or simulator can start.</p>
    <dl className="application-status-grid"><div><dt>Protocol</dt><dd>{validation.valid?'approved':'awaiting owner inputs'}</dd></div><div><dt>Frontend source</dt><dd>not recorded</dd></div><div><dt>Simulator</dt><dd>not started</dd></div><div><dt>Device status</dt><dd>unavailable</dd></div></dl>
    {!validation.valid&&<details><summary>{validation.blockers.length} protocol blockers</summary><ul>{validation.blockers.map((blocker,index)=><li key={index}>{blocker}</li>)}</ul></details>}
    <p className="application-status-note">Simulator evidence and real-device evidence remain separate lifecycle states.</p>
  </section>;
}

