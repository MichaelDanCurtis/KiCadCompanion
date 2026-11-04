import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(join(fileURLToPath(new URL('.',import.meta.url)),'..'));
const allowedStates=new Set(['proposed','ready','in-progress','awaiting-user','blocked','verified','deferred']);
const criterionPattern=/^BL-\d{2}-A[1-5]$/;

function acceptanceMatrix(markdown){
  const heading=/^## .*acceptance.*$/im.exec(markdown);
  if(!heading)return {rows:[],error:'missing acceptance matrix heading'};
  const start=heading.index+heading[0].length;
  const rest=markdown.slice(start);
  const end=rest.search(/^## /m);
  const section=rest.slice(0,end<0?undefined:end);
  const rows=[];
  for(const match of section.matchAll(/^\|\s*(BL-\d{2}-A[1-5])\s*\|\s*([^|]+?)\s*\|/gm)) rows.push({id:match[1],result:match[2].trim()});
  return {rows,error:null};
}

function graphIssues(goals){
  const ids=new Set(goals.map(goal=>goal.id));
  const issues=[];
  for(const goal of goals){
    if(!ids.has(goal.id))issues.push(`missing goal id ${goal.id}`);
    for(const dependency of goal.dependsOn??[]){
      if(!ids.has(dependency))issues.push(`${goal.id}: unknown dependency ${dependency}`);
      if(dependency===goal.id)issues.push(`${goal.id}: self dependency`);
    }
  }
  const visiting=new Set(),visited=new Set();
  function visit(id){
    if(visiting.has(id)){issues.push(`dependency cycle at ${id}`);return;}
    if(visited.has(id))return;
    visiting.add(id); const goal=goals.find(item=>item.id===id);
    for(const dependency of goal?.dependsOn??[])if(ids.has(dependency))visit(dependency);
    visiting.delete(id);visited.add(id);
  }
  for(const goal of goals)visit(goal.id);
  return issues;
}

export {acceptanceMatrix,graphIssues};

export async function auditRoadmap({workspaceRoot=root}={}){
  const status=JSON.parse(await readFile(join(workspaceRoot,'docs/benchline/status.json'),'utf8'));
  const goals=status.goals??[];
  const issues=[];
  if(status.product!=='Benchline')issues.push('status product must be Benchline');
  if(goals.length!==14)issues.push(`expected 14 goals, found ${goals.length}`);
  const ids=goals.map(goal=>goal.id);
  if(new Set(ids).size!==ids.length)issues.push('duplicate goal ids');
  issues.push(...graphIssues(goals));
  const criteria=[]; const perGoal=[];
  for(const goal of goals){
    const contractPath=join(workspaceRoot,'docs/benchline',goal.contract);
    const evidencePath=join(workspaceRoot,'docs/benchline',goal.evidence);
    let contract,evidence;
    try{contract=await readFile(contractPath,'utf8')}catch{issues.push(`${goal.id}: missing contract ${goal.contract}`);continue}
    try{evidence=await readFile(evidencePath,'utf8')}catch{issues.push(`${goal.id}: missing evidence ${goal.evidence}`);continue}
    const contractIds=[...contract.matchAll(/\*\*(BL-\d{2}-A[1-5])\*\*/g)].map(match=>match[1]);
    const matrix=acceptanceMatrix(evidence);
    if(matrix.error)issues.push(`${goal.id}: ${matrix.error}`);
    const matrixIds=matrix.rows.map(row=>row.id);
    if(contractIds.length!==5||new Set(contractIds).size!==5)issues.push(`${goal.id}: contract must contain five unique acceptance ids`);
    if(matrix.rows.length!==5||new Set(matrixIds).size!==5)issues.push(`${goal.id}: current evidence matrix must contain five unique rows`);
    for(const id of contractIds)if(!matrixIds.includes(id))issues.push(`${goal.id}: evidence missing ${id}`);
    const resultById=Object.fromEntries(matrix.rows.map(row=>[row.id,row.result]));
    const goalCriteria=contractIds.map(id=>({id,result:resultById[id]??null}));
    criteria.push(...goalCriteria);
    if(!allowedStates.has(goal.state))issues.push(`${goal.id}: unsupported state ${goal.state}`);
    if(goal.state==='verified'){
      for(const criterion of goalCriteria)if(!/^pass\b/i.test(criterion.result??''))issues.push(`${goal.id}: verified goal has non-pass ${criterion.id} (${criterion.result??'missing'})`);
    }
    perGoal.push({id:goal.id,state:goal.state,criteria:goalCriteria,contract:goal.contract,evidence:goal.evidence});
  }
  return {valid:issues.length===0,issues,goalCount:goals.length,criterionCount:criteria.length,goals:perGoal};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const report=await auditRoadmap();
  console.log(JSON.stringify(report,null,2));
  process.exitCode=report.valid?0:1;
}
