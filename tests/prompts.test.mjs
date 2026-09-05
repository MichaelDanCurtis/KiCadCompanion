import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { studioPrompt, chatPrompt } from '../server/prompts.mjs';

const options = { color: 'green', style: 'Neutral lighting', models: { missing: ['U1'] } };
const context = { board: 'fixture.kicad_pcb', status: 'live', selectedReferences: ['U1'] };

test('studio no-edit restrictions expire with this request without authorizing future edits', () => {
  const prompt = studioPrompt(options);
  assert.match(prompt, /^For this image-generation request only:/);
  assert.match(prompt, /For this request only, do not edit or save any KiCad file or change component selection/);
  assert.match(prompt, /end when this request completes or is cancelled/);
  assert.match(prompt, /later user-authorized design tasks, including assigning component 3D models through Konnect MCP/);
  assert.match(prompt, /does not authorize future edits: explicit user restrictions, normal approvals, and Konnect safety rules still apply/);
});

test('studio retains actual-render fidelity and built-in image-generation constraints', () => {
  const prompt = studioPrompt(options);
  assert.match(prompt, /attached actual KiCad render/);
  assert.match(prompt, /green solder mask/);
  assert.match(prompt, /Visual direction: Neutral lighting/);
  assert.ok(prompt.includes(JSON.stringify(options.models)));
  assert.match(prompt, /If components have no models, leave them absent/);
  assert.match(prompt, /illustrative product image, not engineering evidence/);
  assert.match(prompt, /built-in image generation tool only, not a shell, script, or API-key fallback/);
  assert.match(studioPrompt({ ...options, color: 'kicad' }), /original solder mask/);
});

test('later chat clarifies legacy studio scope and preserves the actual user request', () => {
  const text = 'Inspect the models, but do not change my board.';
  const prompt = chatPrompt({ text, mode: 'agent', context });
  assert.match(prompt, /restrictions automatically added by the companion to a prior AI studio request applied only to that image-generation request/);
  assert.match(prompt, /does not override explicit user restrictions or authorize unrequested edits/);
  assert.match(prompt, /normal approvals and Konnect safety rules still apply/);
  assert.ok(prompt.includes(text));
  assert.ok(prompt.endsWith('Companion context: ' + JSON.stringify(context)));
});

test('discussion remains read-only and studio input does not relax its own restrictions', () => {
  assert.match(chatPrompt({ text: 'Inspect U1', mode: 'discuss', context }), /DISCUSS ONLY: explain and inspect, do not modify design files\. Inspect U1/);
  const prompt = chatPrompt({ text: studioPrompt(options), mode: 'agent', context, studio: true });
  assert.doesNotMatch(prompt, /Companion workflow scope:/);
  assert.match(prompt, /^For this image-generation request only:/);
});

test('server routes studio and conversation input through the scoped prompt builders', async () => {
  const source = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ studioPrompt, chatPrompt \} from '\.\/prompts\.mjs'/);
  assert.match(source, /const prompt=studioPrompt\(\{ color: job\.options\.color, style, models: job\.models \}\)/);
  assert.match(source, /text: chatPrompt\(\{ text, mode, studio: Boolean\(imagePath\), context:/);
  assert.doesNotMatch(source, /Do not edit or save any KiCad file or change component selection/);
});
