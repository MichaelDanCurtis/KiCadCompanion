import React from 'react';
import pendingRecord from '../docs/benchline/physical/ESP32-S3-EYE-v2.2-acceptance.pending.json' with {type:'json'};
import {validatePhysicalAcceptance} from '../shared/physical-acceptance.mjs';

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
export function PhysicalStatusPanel(){
  const validation=validatePhysicalAcceptance(pendingRecord,{expectedTarget:target});
  return <section className="physical-status" aria-label="Physical acceptance readiness">
    <h3>Physical acceptance readiness</h3><p>Selected target: <strong>{target.model} {target.hardwareRevision}</strong>. Human authorization and measurements are required before hardware action.</p>
    <dl className="physical-status-grid"><div><dt>Unit identity</dt><dd>not supplied</dd></div><div><dt>Flash/power authorization</dt><dd>not approved</dd></div><div><dt>Measurements</dt><dd>not recorded</dd></div><div><dt>Fit result</dt><dd>not observed</dd></div><div><dt>Operator record</dt><dd>not supplied</dd></div></dl>
    {!validation.valid&&<details><summary>{validation.blockers.length} acceptance blockers</summary><ul>{validation.blockers.map((blocker,index)=><li key={index}>{blocker}</li>)}</ul></details>}
    <p className="physical-status-note">Simulated, rendered, or inferred values cannot satisfy physical acceptance.</p>
  </section>;
}

