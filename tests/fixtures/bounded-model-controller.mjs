// Test-only authenticated controller: one exact prompt/proposal/decision, no retry.
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {ProductProviderController} from '../../server/provider-controller.mjs';
import {openCandidateCodeModeProfile} from '../../server/provider-profile.mjs';
import {availableTextModels, openCandidateModelTransport} from '../../server/provider-model.mjs';
import {smokeDefault} from './provider-authenticated-smoke.mjs';

export function boundedModelController({gate, root, binary, prompt, expected, calls,
  openProfile = openCandidateCodeModeProfile, deadlineMs = 90000}) {
  assert.ok(Number.isInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 90000);
  const report = {authenticatedCandidate:true, productionEnabled:false, profileAttempts:0,
    turnAttempts:0, acceptedTurns:0, proposals:0, decisions:[], heldApprovalObserved:false,
    turnStatus:null, timedOut:false, workspaceEmpty:null};
  let timer, rpc, cwd, closing;
  const prepare=gate.prepare.bind(gate),decide=gate.decide.bind(gate),wait=gate.waitForDecision.bind(gate);
  gate.prepare=async input=>{
    assert.equal(report.turnAttempts,1);assert.equal(report.proposals,0);
    report.proposals++; // Invalid proposals also consume the one-attempt bound.
    const {idempotencyKey,...actual}=input;
    assert.deepEqual(actual,expected);
    return prepare(input);
  };
  gate.waitForDecision=async(id,options)=>{
    assert.equal(gate.get(id).state,'awaiting-approval');assert.equal(calls(),0);
    report.heldApprovalObserved=true;return wait(id,options);
  };
  gate.decide=async(id,decision)=>{
    assert.ok(['once','decline'].includes(decision));
    const action=await decide(id,decision);report.decisions.push(decision);return action;
  };
  const controller=new ProductProviderController({gate,requireMode:mode=>assert.equal(mode,'agent'),
    openTransport:async({signal})=>{
      assert.equal(report.profileAttempts,0,'One profile attempt; no reconnect or retry');report.profileAttempts++;
      const opened=await openProfile({binary,root,signal});rpc=opened.rpc;cwd=opened.cwd;
      try{
        report.model=smokeDefault(await availableTextModels(rpc));
        rpc=await openCandidateModelTransport({binary,root,model:report.model,signal,openProfile:async()=>opened});
        const request=rpc.request.bind(rpc),onEvent=rpc.onEvent;
        rpc.request=async(method,params,timeout)=>{
          if(method==='turn/start'){
            assert.equal(report.turnAttempts,0,'One model turn; no retry');
            assert.equal(params.input?.[0]?.text,prompt,'Exact displayed prompt only');report.turnAttempts++;
            timer=setTimeout(()=>{report.timedOut=true;rpc.close().catch(()=>{});},deadlineMs);
            try{const result=await request(method,params,timeout);report.acceptedTurns++;return result;}
            catch(error){clearTimeout(timer);throw error;}
          }
          return request(method,params,timeout);
        };
        rpc.onEvent=event=>{
          if(event.method==='turn/completed'&&event.params?.threadId===rpc.toolSession?.snapshot().threadId){
            report.turnStatus=event.params.turn?.status;clearTimeout(timer);
          }
          onEvent?.(event);
        };
        return rpc;
      }catch(error){await rpc.close();throw error;}
    }});
  return {controller,report,close:()=>closing||=(async()=>{
    clearTimeout(timer);await controller.close();
    if(cwd)report.workspaceEmpty=(await readdir(cwd)).length===0;
  })()};
}
