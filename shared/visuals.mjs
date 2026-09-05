import { z } from 'zod';

export const CATALOG_ID = 'https://kicad-companion.invalid/catalogs/engineering-v1';
const text = z.string().max(2000);
export const chartSchema = z.object({
  title: text, source: text, type: z.enum(['bar', 'line']), unit: z.string().max(40).default(''),
  data: z.array(z.object({ label: z.string().max(100), value: z.number().finite(),
    reference: z.string().max(40).optional() }).strict()).min(1).max(100),
}).strict();
export const tableSchema = z.object({ title: text, source: text,
  columns: z.array(z.string().max(100)).min(1).max(10),
  rows: z.array(z.array(z.string().max(500)).max(10)).max(100),
}).strict();
export const networkSchema = z.object({ title: text, source: text,
  nodes: z.array(z.object({ id: z.string().max(60), label: z.string().max(100), reference: z.string().max(40).optional() }).strict()).min(1).max(24),
  edges: z.array(z.object({ from: z.string().max(60), to: z.string().max(60), label: z.string().max(100).optional() }).strict()).max(60),
}).strict().superRefine((v, ctx) => {
  const ids = new Set(v.nodes.map(n => n.id));
  if (ids.size !== v.nodes.length || v.edges.some(e => !ids.has(e.from) || !ids.has(e.to)))
    ctx.addIssue({ code: 'custom', message: 'Graph IDs must be unique and every edge must reference existing nodes' });
});
export const visualSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  kind: z.enum(['Chart', 'DataTable', 'Network']),
  spec: z.record(z.unknown()),
}).strict();
export function visualMessages(input, { existing = false } = {}) {
  const v = visualSchema.parse(input);
  const schema = { Chart: chartSchema, DataTable: tableSchema, Network: networkSchema }[v.kind];
  const spec = schema.parse(v.spec);
  return [
    ...(!existing ? [{ version: 'v0.9', createSurface: { surfaceId: v.id, catalogId: CATALOG_ID } }] : []),
    { version: 'v0.9', updateComponents: { surfaceId: v.id, components: [
      { id: 'root', component: v.kind, ...spec },
    ] } },
  ];
}
