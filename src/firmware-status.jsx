import React from 'react';
import pendingContract from '../docs/benchline/firmware/ESP32-S3-EYE-v2.2-contract.pending.json' with {type:'json'};
import {validateFirmwareContract} from '../shared/firmware-contract.mjs';

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};

/** Read-only lifecycle surface. A registered file is not evidence of a build or device test. */
export function FirmwareStatusPanel() {
  const validation=validateFirmwareContract(pendingContract,{expectedTarget:target});
  return <section className="firmware-status" aria-label="Firmware readiness">
    <h3>Firmware readiness</h3>
    <p>Selected target: <strong>{target.model} {target.hardwareRevision}</strong>. The pending contract is checked before any build or flash request.</p>
    <p>SDK policy: <strong>compatible ESP-IDF releases {pendingContract.bsp.idfRequirement}</strong>; each build records its concrete release and toolchain.</p>
    <dl className="firmware-status-grid">
      <div><dt>Contract</dt><dd>{validation.valid?'approved':'awaiting owner inputs'}</dd></div>
      <div><dt>Generated</dt><dd>not recorded</dd></div>
      <div><dt>Built</dt><dd>not run</dd></div>
      <div><dt>Device-tested</dt><dd>not run</dd></div>
    </dl>
    {!validation.valid&&<details><summary>{validation.blockers.length} contract blockers</summary><ul>{validation.blockers.map((blocker,index)=><li key={index}>{blocker}</li>)}</ul></details>}
    <p className="firmware-status-note">These states are intentionally separate: a source file, build artifact, and physical device result require different evidence.</p>
  </section>;
}
