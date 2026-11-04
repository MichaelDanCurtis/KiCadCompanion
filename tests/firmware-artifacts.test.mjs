import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFirmwareArtifacts} from '../shared/firmware-contract.mjs';

test('accepts portable credential-free firmware source and build records',()=>{
  const result=inspectFirmwareArtifacts([{path:'main/app.c',content:'#include "config.h"\nconst char *target = "ESP32-S3-EYE";'},
    {path:'build/manifest.json',content:'{"target":"esp32s3","sourceRevision":"eye-v2.2-review-1"}'}]);
  assert.equal(result.clean,true);assert.deepEqual(result.blockers,[]);assert.equal(result.artifactCount,2);
});

test('rejects credentials, absolute machine paths and non-relative artifact locators',()=>{
  const result=inspectFirmwareArtifacts([
    {path:'main/app.c',content:'const char *api_key = "secret";'},
    {path:'build/manifest.json',content:`{"sdk":"${['/','Users/example/esp-idf'].join('')}"}`},
    {path:'/tmp/output.bin',content:'binary placeholder'},
  ]);
  assert.equal(result.clean,false);assert.ok(result.blockers.some(b=>b.includes('possible credential')));
  assert.ok(result.blockers.some(b=>b.includes('machine-specific absolute path')));
  assert.ok(result.blockers.some(b=>b.includes('workspace-relative')));
});

test('empty artifact sets fail closed',()=>{
  const result=inspectFirmwareArtifacts([]);assert.equal(result.clean,false);assert.ok(result.blockers.includes('No firmware artifacts were supplied'));
});
