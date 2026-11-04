import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';

const key=z.string().min(1).max(240);
const revisions=z.record(key,z.string().min(1).max(512));
const taskSchema=z.object({id:z.string().uuid(),title:key,adapter:key,
  dependencies:z.array(z.string().uuid()).max(100),documents:z.array(key).max(100),
  inputs:revisions,acceptance:z.array(z.object({id:key,description:key}).strict()).min(1).max(100),
  params:z.record(z.unknown()).default({})}).strict();
const planSchema=z.object({id:z.string().uuid(),projectId:z.string().uuid(),title:key,
  tasks:z.array(taskSchema).min(1).max(200)}).strict();
const fail=message=>Object.assign(Error(message),{status:409});
const canonical=value=>JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const now=()=>new Date().toISOString();
const parse=JSON.parse;

/** Workflow storage is not an action authority. Only host-registered adapters
 * execute, and mutating adapters must separately validate an ActionGate receipt.
 * The mutex database holds an OS-released SQLite lock for this store's lifetime;
 * the journal uses independent, fully synchronous committed transactions.
 */
export class WorkflowStore {
  #db; #owner; #adapters; #observe; #pending=new Map(); #closing=false; #close;
  constructor({path,adapters=new Map(),observeInputs}) {
    if(typeof observeInputs!=='function') throw Error('Workflow input observer required');
    this.#adapters=adapters;this.#observe=observeInputs;
    const target=resolve(path);mkdirSync(dirname(target),{recursive:true,mode:0o700});
    try {
      this.#owner=new DatabaseSync(target+'.owner.sqlite');
      this.#owner.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
      this.#db=new DatabaseSync(target);
      this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      chmodSync(target,0o600);chmodSync(target+'.owner.sqlite',0o600);
      const version=this.#db.prepare('PRAGMA user_version').get().user_version;
      if(version>1) throw Error('Workflow database is newer than this application');
      if(version===0) this.#transaction(()=>this.#db.exec(`
        CREATE TABLE plans(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE tasks(id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), spec TEXT NOT NULL,
          state TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, stale INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL);
        CREATE TABLE dependencies(task_id TEXT NOT NULL REFERENCES tasks(id), prerequisite TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(task_id,prerequisite));
        CREATE TABLE attempts(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), phase TEXT NOT NULL,
          approval TEXT, inputs TEXT NOT NULL, output TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE document_locks(document TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id));
        CREATE TABLE evidence(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), attempt_id TEXT NOT NULL REFERENCES attempts(id),
          criterion TEXT NOT NULL, inputs TEXT NOT NULL, record TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE, fingerprint TEXT,
          kind TEXT NOT NULL, task_id TEXT, detail TEXT NOT NULL, created_at TEXT NOT NULL);
        PRAGMA user_version=1;
      `));
      this.#transaction(()=>{
        for(const attempt of this.#db.prepare("SELECT * FROM attempts WHERE phase IN ('approved','executing','verifying')").all()) {
          const phase=attempt.phase==='executing'?'unknown-outcome':attempt.phase==='approved'?'interrupted':'verifying';
          this.#db.prepare('UPDATE attempts SET phase=?, updated_at=? WHERE id=?').run(phase,now(),attempt.id);
          this.#state(attempt.task_id,phase,phase==='unknown-outcome'?'The process stopped during execution. Observe or reconcile; do not retry.':
            phase==='interrupted'?'Execution had not started. Review a new attempt.':'Output is recorded. Resume observation without executing again.');
          if(phase==='interrupted') this.#unlock(attempt.id);
          this.#event('recovery',attempt.task_id,{attemptId:attempt.id,from:attempt.phase,to:phase});
        }
      });
    } catch(error) {try{this.#db?.close();}catch{}try{this.#owner?.close();}catch{}throw error;}
  }
  #transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try{const result=fn();this.#db.exec('COMMIT');return result;}catch(error){this.#db.exec('ROLLBACK');throw error;}
  }
  #event(kind,taskId,detail,requestId=null,fingerprint=null) {
    this.#db.prepare('INSERT INTO events(request_id,fingerprint,kind,task_id,detail,created_at) VALUES(?,?,?,?,?,?)')
      .run(requestId,fingerprint,kind,taskId,canonical(detail),now());
  }
  #request(requestId,payload,fn) {
    key.parse(requestId);const fingerprint=hash(payload);
    return this.#transaction(()=>{
      const prior=this.#db.prepare('SELECT * FROM events WHERE request_id=?').get(requestId);
      if(prior){if(prior.fingerprint!==fingerprint)throw fail('Request ID was already used for different work');return parse(prior.detail);}
      const result=fn();this.#event(payload.kind,payload.taskId||null,result,requestId,fingerprint);return result;
    });
  }
  #admit(){if(this.#closing)throw fail('Workflow store is closing');}
  #task(id){const row=this.#db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!row)throw fail('Unknown workflow task');return {...row,spec:parse(row.spec)};}
  #state(id,state,reason){this.#db.prepare('UPDATE tasks SET state=?,reason=? WHERE id=?').run(state,reason,id);}
  #unlock(attemptId){this.#db.prepare('DELETE FROM document_locks WHERE attempt_id=?').run(attemptId);}
  #latest(id){return this.#db.prepare('SELECT * FROM attempts WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(id);}
  #refreshReady(planId) {
    for(const row of this.#db.prepare('SELECT * FROM tasks WHERE plan_id=?').all(planId)) {
      if(!row.enabled || !['proposed','ready'].includes(row.state))continue;
      const deps=this.#db.prepare('SELECT t.* FROM dependencies d JOIN tasks t ON t.id=d.prerequisite WHERE d.task_id=?').all(row.id);
      const blocked=deps.find(d=>d.state!=='completed'||d.stale);
      this.#state(row.id,blocked?'proposed':'ready',blocked?`Waiting for ${parse(blocked.spec).title}: ${blocked.stale?'stale evidence':blocked.state}`:
        row.stale?'Inputs changed. Review the plan before execution.':'Prerequisites have current evidence. Ready for review.');
    }
  }
  create(raw,requestId) {
    this.#admit();const plan=planSchema.parse(raw),byId=new Map(plan.tasks.map(t=>[t.id,t]));
    if(byId.size!==plan.tasks.length)throw fail('Duplicate task IDs');
    const visiting=new Set(),done=new Set();
    const visit=id=>{if(visiting.has(id))throw fail('Workflow dependency cycle');if(done.has(id))return;
      const t=byId.get(id);if(!t)throw fail('Dependency is outside this plan');visiting.add(id);
      if(new Set(t.acceptance.map(c=>c.id)).size!==t.acceptance.length)throw fail('Duplicate acceptance IDs');
      if(new Set(t.dependencies).size!==t.dependencies.length || new Set(t.documents).size!==t.documents.length)throw fail('Duplicate dependencies or documents');
      for(const dep of t.dependencies)visit(dep);visiting.delete(id);done.add(id);};
    for(const t of plan.tasks)visit(t.id);
    this.#request(requestId,{kind:'plan-created',plan},()=>{
      this.#db.prepare('INSERT INTO plans VALUES(?,?,?,?)').run(plan.id,plan.projectId,plan.title,now());
      for(const task of plan.tasks)this.#db.prepare('INSERT INTO tasks(id,plan_id,spec,state,reason) VALUES(?,?,?,?,?)')
        .run(task.id,plan.id,canonical(task),'proposed','Proposed; execution has not been requested.');
      for(const task of plan.tasks)for(const dep of task.dependencies)this.#db.prepare('INSERT INTO dependencies VALUES(?,?)').run(task.id,dep);
      return {planId:plan.id};
    });return this.get(plan.id);
  }
  activate(planId,requestId) {
    this.#admit();this.get(planId);
    this.#request(requestId,{kind:'plan-activated',planId},()=>{
      this.#db.prepare('UPDATE tasks SET enabled=1 WHERE plan_id=?').run(planId);this.#refreshReady(planId);return {planId};
    });return this.get(planId);
  }
  get(planId) {
    const plan=this.#db.prepare('SELECT * FROM plans WHERE id=?').get(planId);if(!plan)throw fail('Unknown workflow plan');
    return {id:plan.id,projectId:plan.project_id,title:plan.title,createdAt:plan.created_at,
      tasks:this.#db.prepare('SELECT * FROM tasks WHERE plan_id=? ORDER BY rowid').all(planId).map(t=>({...parse(t.spec),state:t.state,
        stale:Boolean(t.stale),reason:t.reason,attempts:this.#db.prepare('SELECT * FROM attempts WHERE task_id=? ORDER BY rowid').all(t.id).map(a=>
          ({id:a.id,phase:a.phase,approvalRef:a.approval,inputs:parse(a.inputs),output:a.output?parse(a.output):null,error:a.error,createdAt:a.created_at,updatedAt:a.updated_at})),
        evidence:this.#db.prepare('SELECT * FROM evidence WHERE task_id=? ORDER BY rowid').all(t.id).map(e=>
          ({id:e.id,attemptId:e.attempt_id,criterion:e.criterion,inputs:parse(e.inputs),record:parse(e.record),createdAt:e.created_at,current:!t.stale && e.attempt_id===this.#latest(t.id)?.id}))})),
      events:this.#db.prepare('SELECT e.* FROM events e LEFT JOIN tasks t ON t.id=e.task_id WHERE t.plan_id=? OR (e.task_id IS NULL AND json_extract(e.detail,\'$.planId\')=?) ORDER BY seq').all(planId,planId).map(e=>
        ({seq:e.seq,kind:e.kind,taskId:e.task_id,detail:parse(e.detail),at:e.created_at}))};
  }
  list(projectId){return this.#db.prepare('SELECT id FROM plans WHERE project_id=? ORDER BY rowid DESC').all(projectId).map(p=>this.get(p.id));}
  refresh(planId) {
    this.#admit();const requestId=`refresh:${planId}`;
    if(this.#pending.has(requestId))return this.#pending.get(requestId).promise;
    const promise=this.#refresh(planId).finally(()=>this.#pending.delete(requestId));
    this.#pending.set(requestId,{promise});return promise;
  }
  async #refresh(planId) {
    const plan=this.get(planId),observed=revisions.parse(await this.#observe(plan.projectId));
    this.#transaction(()=>{
      const stale=new Set(plan.tasks.filter(t=>Object.entries(t.inputs).some(([k,v])=>observed[k]!==v)).map(t=>t.id));
      let changed;do{changed=false;for(const t of plan.tasks)if(!stale.has(t.id)&&t.dependencies.some(d=>stale.has(d))){stale.add(t.id);changed=true;}}while(changed);
      for(const task of plan.tasks)if(stale.has(task.id)&&!task.stale){
        this.#db.prepare('UPDATE tasks SET stale=1,reason=? WHERE id=?').run('Inputs changed. Prior evidence is retained; create a reviewed plan for the current revision.',task.id);
        this.#event('evidence-stale',task.id,{expected:task.inputs,observed});
      }
      this.#refreshReady(planId);
    });return this.get(planId);
  }
  run(taskId,{requestId,approvalRef=null}={}) {
    this.#admit();const existing=this.#pending.get(requestId);if(existing){if(existing.taskId!==taskId||existing.approvalRef!==approvalRef)return Promise.reject(fail('Request ID collision'));return existing.promise;}
    const promise=this.#run(taskId,{requestId,approvalRef}).finally(()=>this.#pending.delete(requestId));
    this.#pending.set(requestId,{taskId,approvalRef,promise});return promise;
  }
  async #run(taskId,{requestId,approvalRef}) {
    key.parse(requestId);if(approvalRef!==null)key.parse(approvalRef);
    const row=this.#task(taskId);await this.#refresh(row.plan_id);this.#admit();
    const receipt=this.#request(requestId,{kind:'attempt-approved',taskId,approvalRef},()=>{
      const task=this.#task(taskId),adapter=this.#adapters.get(task.spec.adapter);
      if(!adapter)throw fail('No qualified adapter is registered for this task');
      if(task.state!=='ready'||task.stale)throw fail('Task is not ready with current inputs');
      if(adapter.mutating && !approvalRef) {throw fail('A scoped action approval reference is required');}
      const id=randomUUID();
      this.#db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)').run(id,taskId,'approved',approvalRef,canonical(task.spec.inputs),null,null,now(),now());
      for(const document of task.spec.documents)this.#db.prepare('INSERT INTO document_locks VALUES(?,?)').run(document,id);
      this.#state(taskId,'awaiting-user','An attempt is recorded; dispatch has not started.');return {attemptId:id};
    });
    const attempt=this.#latest(taskId);
    // An idempotency receipt is not authorization to repeat an earlier attempt.
    if(attempt.id!==receipt.attemptId || attempt.phase!=='approved')return this.get(row.plan_id);
    const adapter=this.#adapters.get(row.spec.adapter);
    // Validation is read-only and must include the existing ActionGate boundary
    // for any mutating adapter. No such adapter is installed by default.
    try {
      if(adapter.mutating && typeof adapter.authorize!=='function')throw fail('Mutating workflow adapter has no action authority');
      if(adapter.authorize)await adapter.authorize({task:row.spec,approvalRef});
      await this.#refresh(row.plan_id);if(this.#task(taskId).stale)throw fail('Input changed before execution');
    } catch(error) {
      this.#transaction(()=>{this.#db.prepare('UPDATE attempts SET phase=?,error=?,updated_at=? WHERE id=?').run('interrupted',error.message,now(),attempt.id);
        this.#state(taskId,'interrupted','Authorization or freshness did not pass; no dispatch occurred.');this.#unlock(attempt.id);this.#event('dispatch-refused',taskId,{attemptId:attempt.id});});throw error;
    }
    this.#transaction(()=>{
      this.#db.prepare('UPDATE attempts SET phase=?,updated_at=? WHERE id=?').run('executing',now(),attempt.id);
      this.#state(taskId,'running','Execution started; a durable result has not been recorded.');this.#event('execution-started',taskId,{attemptId:attempt.id});
    });
    let output;
    try {output=await adapter.execute({task:row.spec,attemptId:attempt.id,approvalRef});
      if(output===undefined)throw Error('Adapter returned no output');canonical(output);
    } catch(error) {
      this.#transaction(()=>{const phase=adapter.mutating?'unknown-outcome':'failed';
        this.#db.prepare('UPDATE attempts SET phase=?,error=?,updated_at=? WHERE id=?').run(phase,error.message,now(),attempt.id);
        this.#state(taskId,phase,phase==='unknown-outcome'?'Execution did not return a durable result. Observe or reconcile before further writes.':error.message);
        if(phase==='failed')this.#unlock(attempt.id);this.#event('execution-unresolved',taskId,{attemptId:attempt.id,phase});this.#refreshReady(row.plan_id);});return this.get(row.plan_id);
    }
    this.#transaction(()=>{this.#db.prepare('UPDATE attempts SET phase=?,output=?,updated_at=? WHERE id=?').run('verifying',canonical(output),now(),attempt.id);
      this.#state(taskId,'verifying','Output is recorded; acceptance evidence is still required.');this.#event('output-recorded',taskId,{attemptId:attempt.id});});
    return this.#verify(taskId);
  }
  async #verify(taskId) {
    const task=this.#task(taskId),attempt=this.#latest(taskId),adapter=this.#adapters.get(task.spec.adapter);
    if(!adapter || typeof adapter.verify!=='function')return this.get(task.plan_id);
    let evidence;
    try {evidence=z.array(z.object({criterion:key,locator:key,revision:key,summary:key,passed:z.boolean()}).strict()).max(100)
      .parse(await adapter.verify({task:task.spec,attemptId:attempt.id,output:parse(attempt.output)}));
      if(new Set(evidence.map(e=>e.criterion)).size!==evidence.length || evidence.some(e=>!task.spec.acceptance.some(c=>c.id===e.criterion)))throw Error('Invalid acceptance evidence IDs');
    } catch(error){this.#transaction(()=>{this.#state(taskId,'verifying',`Verification needs attention: ${error.message}`);this.#event('verification-unavailable',taskId,{attemptId:attempt.id});});return this.get(task.plan_id);}
    await this.#refresh(task.plan_id);
    this.#transaction(()=>{
      for(const e of evidence)this.#db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(),taskId,attempt.id,e.criterion,attempt.inputs,canonical(e),now());
      const all=task.spec.acceptance.every(c=>evidence.some(e=>e.criterion===c.id&&e.passed));
      const phase=all&&!this.#task(taskId).stale?'completed':'failed';
      this.#db.prepare('UPDATE attempts SET phase=?,updated_at=? WHERE id=?').run(phase,now(),attempt.id);
      this.#state(taskId,phase,phase==='completed'?'Every acceptance item has evidence for the recorded inputs.':'Acceptance evidence is missing, failed, or stale.');
      this.#unlock(attempt.id);this.#event('verification-recorded',taskId,{attemptId:attempt.id,phase,evidenceCount:evidence.length});this.#refreshReady(task.plan_id);
    });return this.get(task.plan_id);
  }
  resumeVerification(taskId) {
    this.#admit();const task=this.#task(taskId),attempt=this.#latest(taskId);
    if(task.state!=='verifying'||attempt?.phase!=='verifying'||!attempt.output)return Promise.reject(fail('Task has no recorded output awaiting verification'));
    const requestId=`verify:${attempt.id}`;if(this.#pending.has(requestId))return this.#pending.get(requestId).promise;
    const promise=this.#verify(taskId).finally(()=>this.#pending.delete(requestId));this.#pending.set(requestId,{taskId,promise});return promise;
  }
  observeOutcome(taskId) {
    this.#admit();const task=this.#task(taskId),attempt=this.#latest(taskId),adapter=this.#adapters.get(task.spec.adapter);
    if(task.state!=='unknown-outcome'||attempt?.phase!=='unknown-outcome'||typeof adapter?.observe!=='function')
      return Promise.reject(fail('A qualified read-only outcome observer is required'));
    const requestId=`observe:${attempt.id}`;if(this.#pending.has(requestId))return this.#pending.get(requestId).promise;
    const promise=(async()=>{
      const observation=z.object({status:z.enum(['applied','not-applied','unknown']),locator:key,revision:key,output:z.unknown().optional()}).strict()
        .parse(await adapter.observe({task:task.spec,attemptId:attempt.id,approvalRef:attempt.approval}));
      if(observation.status==='applied'&&observation.output===undefined)throw fail('Observed output is required');
      this.#transaction(()=>{
        this.#event('outcome-observed',taskId,{attemptId:attempt.id,observation});
        if(observation.status==='unknown')return;
        const phase=observation.status==='applied'?'verifying':'interrupted';
        this.#db.prepare('UPDATE attempts SET phase=?,output=?,updated_at=? WHERE id=?')
          .run(phase,observation.status==='applied'?canonical(observation.output):null,now(),attempt.id);
        this.#state(taskId,phase,phase==='verifying'?'The result was observed; verify without executing again.':'Observation confirmed no write. Review before a new attempt.');
        if(phase==='interrupted')this.#unlock(attempt.id);
      });
      return observation.status==='applied'?this.#verify(taskId):this.get(task.plan_id);
    })().finally(()=>this.#pending.delete(requestId));this.#pending.set(requestId,{taskId,promise});return promise;
  }
  reviewRetry(taskId,requestId) {
    this.#admit();const task=this.#task(taskId);
    this.#request(requestId,{kind:'retry-reviewed',taskId},()=>{
      const current=this.#task(taskId);
      if(!['interrupted','failed'].includes(current.state)||current.stale)throw fail('Only failed or interrupted work with current inputs can be reviewed for retry');
      this.#state(taskId,'proposed','Retry reviewed; checking prerequisites.');this.#refreshReady(task.plan_id);return {taskId};
    });return this.get(task.plan_id);
  }
  async close() {
    if(this.#close)return this.#close;this.#closing=true;
    this.#close=(async()=>{await Promise.allSettled([...this.#pending.values()].map(p=>p.promise));
      this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');this.#db.close();this.#owner.close();})();return this.#close;
  }
}
