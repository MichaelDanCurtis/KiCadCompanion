import {z} from 'zod';
export const actionInput=z.object({projectId:z.string().uuid(),documentId:z.string().uuid(),adapter:z.string().min(1).max(80),operation:z.string().min(1).max(80),args:z.record(z.unknown()),mode:z.enum(['discuss','agent']),idempotencyKey:z.string().uuid()}).strict();
export const observationSchema=z.object({projectId:z.string().uuid(),documentId:z.string().uuid(),path:z.string(),revision:z.string().min(1),observedAt:z.number(),connected:z.literal(true)}).strict();
export const previewSchema=z.object({revision:z.string().min(1),summary:z.string().min(1).max(4000),confirmation:z.string().min(1).max(4000)}).strict();
export const terminalStates=new Set(['verified','declined','cancelled','expired','failed','unknown']);
// Host adapter data only. Persist before dispatch so crash recovery can inspect
// the original native attempt; never treat this as model-supplied authorization.
export const dispatchSchema=z.record(z.unknown()).refine(value=>new TextEncoder().encode(JSON.stringify(value)).byteLength<=32768,'Dispatch metadata too large');
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),time=z.number().finite();
export const recoveryInspectionSchema=z.object({version:z.literal(1),revision:z.string().min(1).max(512),
  basis:z.enum(['read-only-operation','postcondition-observed','precondition-observed']),
  summary:z.string().min(1).max(2000),details:z.record(z.unknown())}).strict();
export const recoveryDecisionSchema=z.object({reviewId:uuid,expectedFingerprint:hash,
  decision:z.literal('accept-current-state'),note:z.string().trim().min(1).max(1000)}).strict();
const recoveryReviewSchema=z.object({id:uuid,at:time,expiresAt:time,fingerprint:hash,
  targetDigest:hash,capabilityDigest:hash,inspection:recoveryInspectionSchema}).strict();
const reconciliationSchema=z.object({at:time,decision:z.literal('accept-current-state'),note:z.string().min(1).max(1000),
  originalOutcome:z.literal('unknown'),replayAuthorized:z.literal(false),review:recoveryReviewSchema,
  grantsRevoked:z.array(uuid).max(1000)}).strict();
export const targetSchema=z.object({projectId:uuid,documentId:uuid,path:z.string().min(1),epoch:uuid,manifestHash:z.string().min(1)}).strict();
const record=z.object({id:uuid,input:actionInput,target:targetSchema,observation:observationSchema,preview:previewSchema,scope:hash,effect:z.enum(['read','write','editor']),createdAt:time,expiresAt:time,
  state:z.enum(['ready','awaiting-approval','approved','executing',...terminalStates]),grantId:uuid.nullable(),decision:z.enum(['once','always','decline']).nullable(),detail:z.string().optional(),dispatch:dispatchSchema.optional(),receipt:z.unknown().optional(),verification:z.unknown().optional(),recovery:z.unknown().optional(),
  recoveryReview:recoveryReviewSchema.optional(),reconciliation:reconciliationSchema.optional()}).strict();
const grant=z.object({id:uuid,scope:hash,projectId:uuid,documentId:uuid,adapter:z.string(),operation:z.string(),args:z.record(z.unknown()),path:z.string(),epoch:uuid,confirmation:z.string(),createdAt:time}).strict();
export const journalSchema=z.object({schemaVersion:z.literal(1),actions:z.array(record).max(1000),grants:z.array(grant).max(1000)}).strict().superRefine((d,ctx)=>{
  if(new Set(d.actions.map(a=>a.id)).size!==d.actions.length||new Set(d.grants.map(g=>g.id)).size!==d.grants.length||new Set(d.actions.map(a=>a.input.projectId+':'+a.input.idempotencyKey)).size!==d.actions.length)ctx.addIssue({code:'custom',message:'Duplicate journal identity'});
  for(const a of d.actions)if(a.target.projectId!==a.input.projectId||a.target.documentId!==a.input.documentId||a.observation.projectId!==a.input.projectId||a.observation.documentId!==a.input.documentId||a.observation.path!==a.target.path)ctx.addIssue({code:'custom',message:'Journal identity mismatch'});
  for(const a of d.actions)if((a.reconciliation||a.recoveryReview)&&a.state!=='unknown')ctx.addIssue({code:'custom',message:'Recovery requires an unknown original outcome'});
});
