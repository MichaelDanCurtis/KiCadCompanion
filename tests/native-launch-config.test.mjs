import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {portableLauncherSettings} from '../scripts/launcher-settings.mjs';

test('native launcher metadata is portable and excludes host-specific paths',()=>{
  const settings=portableLauncherSettings();
  assert.equal(settings.node,'node');
  assert.equal(settings.script,'scripts/launch.mjs');
  assert.equal(settings.workingDirectory,'../../../../');
  const text=JSON.stringify(settings);
  assert.doesNotMatch(text,/(?:^|["'])\/(?:Users|Volumes|private|home)\//);
  assert.doesNotMatch(text,/(?:^|["'])[A-Za-z]:[\\/]/);
});

test('native launcher working directory resolves from bundle resources to checkout root',()=>{
  const resource='/checkout/.runtime/Benchline.app/Contents/Resources';
  assert.equal(resolve(resource,portableLauncherSettings().workingDirectory),'/checkout');
  assert.equal(resolve('/checkout',portableLauncherSettings().script),'/checkout/scripts/launch.mjs');
});

test('portable native environment starts neutral and uses relative runtime paths',()=>{
  const {env}=portableLauncherSettings();
  assert.equal(env.BENCHLINE_WORKSPACE,'');
  assert.equal(env.BENCHLINE_AUTOCONNECT,'0');
  assert.equal(env.BENCHLINE_STATE_DIR,'.runtime/benchline');
  assert.equal(env.BENCHLINE_BOARDS_DIR,'projects');
  for(const value of Object.values(env)) assert.doesNotMatch(value,/(?:^|["'])\/(?:Users|Volumes|private|home)\//);
});
