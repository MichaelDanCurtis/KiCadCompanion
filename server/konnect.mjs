import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from './config.mjs';

export function unpack(result) {
  const texts = (result.content || []).filter(c => c.type === 'text').map(c => c.text);
  let data;
  try { data = JSON.parse(texts.join('\n')); } catch { data = { text: texts.join('\n') }; }
  if (result.isError) throw new Error(data.message || JSON.stringify(data));
  return data;
}

export class Konnect {
  constructor({configPath=null}={}) { this.queue = Promise.resolve();this.configPath=configPath; }
  async connect() {
    this.client = new Client({ name: 'kicad-companion-observer', version: '0.1.0' });
    this.transport = new StdioClientTransport({ command: config.konnect,args:this.configPath?['--config',this.configPath]:[],
      env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)), stderr: 'pipe' });
    this.transport.stderr?.on('data', () => {});
    await this.client.connect(this.transport);
    await this.call('list_toolboxes');
    await this.call('load_user_config');
    await this.call('load_toolset', { name: ['pcb_board', 'pcb_components', 'pcb_export', 'verification'] });
    this.tools = (await this.client.listTools()).tools;
  }
  call(name, args = {}) {
    const run = () => this.client.callTool({ name, arguments: args }, undefined, { timeout: 30000 }).then(unpack);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
  async close() { await this.client?.close(); }
}
