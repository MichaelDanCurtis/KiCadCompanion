import React from 'react';
import pendingCandidate from '../docs/benchline/release/ESP32-S3-EYE-v2.2-private-preview.pending.json' with {type:'json'};
import {validatePrivatePreviewCandidate} from '../shared/private-preview-candidate.mjs';

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
export function ReleaseStatusPanel(){
  const validation=validatePrivatePreviewCandidate(pendingCandidate,{expectedTarget:target});
  return <section className="release-status" aria-label="Private preview readiness">
    <h3>Private preview readiness</h3><p>Candidate packaging stays blocked until BL-12 software and BL-13 physical evidence are current.</p>
    <dl className="release-status-grid"><div><dt>Candidate package</dt><dd>not assembled</dd></div><div><dt>Fresh install</dt><dd>not observed</dd></div><div><dt>Rollback</dt><dd>not exercised</dd></div><div><dt>Privacy / SBOM</dt><dd>not recorded</dd></div><div><dt>Owner review</dt><dd>pending</dd></div></dl>
    {!validation.valid&&<details><summary>{validation.blockers.length} release blockers</summary><ul>{validation.blockers.map((blocker,index)=><li key={index}>{blocker}</li>)}</ul></details>}
    <p className="release-status-note">A complete record still does not authorize installation, publication, signing, or external upload.</p>
  </section>;
}
