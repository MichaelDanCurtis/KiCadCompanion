import React from 'react';
import pendingContract from '../docs/benchline/mechanical/ESP32-S3-EYE-v2.2-contract.pending.json' with {type:'json'};
import {validateMechanicalContract} from '../shared/mechanical-contract.mjs';

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
export function MechanicalStatusPanel(){
  const validation=validateMechanicalContract(pendingContract,{expectedTarget:target});
  return <section className="mechanical-status" aria-label="Mechanical readiness">
    <h3>Mechanical readiness</h3><p>Selected target: <strong>{target.model} {target.hardwareRevision}</strong>. The pending envelope is checked before any native document action.</p>
    <dl className="mechanical-status-grid"><div><dt>Contract</dt><dd>{validation.valid?'approved':'awaiting owner inputs'}</dd></div><div><dt>FreeCAD document</dt><dd>not recorded</dd></div><div><dt>Dimension checks</dt><dd>not run</dd></div><div><dt>Fit result</dt><dd>not run</dd></div></dl>
    {!validation.valid&&<details><summary>{validation.blockers.length} contract blockers</summary><ul>{validation.blockers.map((blocker,index)=><li key={index}>{blocker}</li>)}</ul></details>}
    <p className="mechanical-status-note">A native editable document, numeric clearances, and physical fit each require separate evidence.</p>
  </section>;
}

