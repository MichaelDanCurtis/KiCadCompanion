import {z} from 'zod';

const count = z.number().int().nonnegative().max(10000000);
const label = z.string().max(256);
// Explicit reviewed shapes only. Never use a generic receipt-to-JSON fallback.
export const providerResultSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('board-metadata'),
  title: label, company: label, date: label, designRevision: label,
  copperLayerCount: count.max(64), layerCount: count.max(256), netCount: count,
  paper: label.nullable(),
  paperSizeMm: z.object({width: z.number().finite().positive().max(10000),
    height: z.number().finite().positive().max(10000)}).strict().nullable(),
  provenance: z.object({source: z.enum(['ipc', 'file']), savedHash: z.string().regex(/^[a-f0-9]{64}$/),
    liveRevision: z.null(), dirty: z.null(),
    scope: z.literal('Read snapshot; saved file unchanged at verification. Live revision and dirty state unknown. Paper metadata comes from the file.'),
    contentIsUntrusted: z.literal(true),
  }).strict(),
}).strict();
