import React from 'react';
import pendingScenario from '../docs/benchline/integration/ESP32-S3-EYE-v2.2-scenario.pending.json' with {type:'json'};
import {validateIntegrationScenario} from '../shared/integration-scenario.mjs';

const target={vendor:'Espressif Systems',model:'ESP32-S3-EYE',hardwareRevision:'v2.2'};
export function IntegrationStatusPanel(){
  const validation=validateIntegrationScenario(pendingScenario,{expectedTarget:target});
  return <section className="integration-status" aria-label="Integration readiness">
    <h3>Cross-discipline readiness</h3><p>Selected target: <strong>{target.model} {target.hardwareRevision}</strong>. A frozen scenario is required before coordinated changes can run.</p>
    <dl className="integration-status-grid"><div><dt>Scenario</dt><dd>{validation.valid?'approved':'awaiting owner inputs'}</dd></div><div><dt>Baseline</dt><dd>not frozen</dd></div><div><dt>Impact run</dt><dd>not run</dd></div><div><dt>Software result</dt><dd>not run</dd></div><div><dt>Physical validation</dt><dd>pending</dd></div></dl>
    {!validation.valid&&<details><summary>{validation.blockers.length} scenario blockers</summary><ul>{validation.blockers.map((blocker,index)=><li key={index}>{blocker}</li>)}</ul></details>}
    <p className="integration-status-note">Native CAD, firmware, simulator and physical results must each retain their own current evidence.</p>
  </section>;
}

