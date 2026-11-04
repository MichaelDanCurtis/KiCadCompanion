import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceMatrix,auditRoadmap} from '../scripts/check-roadmap.mjs';

test('current roadmap audit covers all contracts and criteria',async()=>{
  const report=await auditRoadmap();
  assert.equal(report.valid,true,report.issues.join('; '));
  assert.equal(report.goalCount,14);
  assert.equal(report.criterionCount,70);
  assert.equal(report.goals.find(goal=>goal.id==='BL-07').state,'verified');
  assert.equal(report.goals.find(goal=>goal.id==='BL-14').state,'awaiting-user');
});

test('acceptance matrix parser limits rows to the first acceptance section',()=>{
  const markdown=`# Evidence\n\n## Acceptance results\n| ID | Result | Notes |\n| --- | --- | --- |\n| BL-01-A1 | pass | current |\n| BL-01-A2 | awaiting-user | current |\n\n## Historical checkpoint\n| BL-01-A1 | fail | old |`;
  const matrix=acceptanceMatrix(markdown);
  assert.equal(matrix.error,null);
  assert.deepEqual(matrix.rows,[{id:'BL-01-A1',result:'pass'},{id:'BL-01-A2',result:'awaiting-user'}]);
});
