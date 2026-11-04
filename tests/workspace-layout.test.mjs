import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultLayout, normalizeLayout, layoutStorageKey} from '../shared/workspace-layout.mjs';

test('saved layout values cannot hide both panes or escape usable width bounds', () => {
  for (const value of [null, {}, {version:2, primary:60}, 'bad']) assert.deepEqual(normalizeLayout(value), defaultLayout);
  for (const primary of [NaN, Infinity, '60', null]) assert.equal(normalizeLayout({version:1, primary}).primary,45);
  assert.deepEqual(normalizeLayout({version:1, primary:-100, collapsed:'both'}),{version:1, primary:25, collapsed:null});
  assert.deepEqual(normalizeLayout({version:1, primary:10000, collapsed:'secondary'}),{version:1, primary:70, collapsed:'secondary'});
  assert.notEqual(layoutStorageKey('project:a'),layoutStorageKey('project:b'));
  assert.notEqual(layoutStorageKey('brief:a'),layoutStorageKey('project:a'));
});
