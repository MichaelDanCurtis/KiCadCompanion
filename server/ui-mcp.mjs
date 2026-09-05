import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { visualSchema } from '../shared/visuals.mjs';
import { renderOptions } from './renders.mjs';

const server = new McpServer({ name: 'kicad-companion', version: '0.1.0' });
async function call(path, body) {
  const response = await fetch(`${process.env.COMPANION_URL}/internal/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.COMPANION_TOKEN}` },
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  return { isError: !response.ok, content: [{ type: 'text', text: JSON.stringify(data) }] };
}
server.registerTool('get_context', { description: 'Read current KiCad board, live selection, components, pad nets, tracks, freshness, and last saved-board DRC. Call before interpreting or editing the board. Never treat disconnected or saved-file data as live.', inputSchema: {} }, () => call('context'));
server.registerTool('present_visual', {
  description: `Render an interactive A2UI engineering surface in the companion window. Reuse id to update a surface. kind Chart: spec {title,source,type:"bar"|"line",unit?,data:[{label,value,reference?}]}. kind DataTable: spec {title,source,columns:string[],rows:string[][]}. kind Network: spec {title,source,nodes:[{id,label,reference?}],edges:[{from,to,label?}]}. Always identify source, units, and whether values are measured, calculated, or illustrative. Do not fabricate results. reference makes charts/graph nodes select a real part in KiCad.`,
  inputSchema: visualSchema.shape,
}, args => call('visual', args));
server.registerTool('select_component', { description: 'Select a reference in the live KiCad editor and companion. Changes selection only, no design mutation.', inputSchema: { reference: z.string().min(1).max(40) } }, args => call('select', args));
server.registerTool('render_board', {description:'Start a read-only KiCad 3D render of the selected SAVED board. Returns a job id immediately; poll render_status for completion. Does not save unsaved edits, assign component models, or change fabrication colors. The result appears in the Render tab. Use this tool rather than running a renderer yourself.',inputSchema:renderOptions.shape},args=>call('render',args));
server.registerTool('render_status', {description:'Read a render job, source fingerprint, model coverage and local image path when ready. Use the actual image as reference before generating illustrative studio imagery.',inputSchema:{id:z.string().uuid()}},args=>call('render-status',args));
await server.connect(new StdioServerTransport());
