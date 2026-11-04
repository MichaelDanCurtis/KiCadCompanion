import test from 'node:test';
import assert from 'node:assert/strict';
import packageJson from '../package.json' with {type:'json'};

test('private preview package allowlist contains runtime and release material',()=>{
  const files=packageJson.files;
  for(const required of ['dist/','server/','shared/','native/','src/','docs/benchline/release/','docs/benchline/licenses/','README.md','THIRD_PARTY.md'])assert.ok(files.includes(required),`missing ${required}`);
});

test('private preview package allowlist excludes internal planning, evidence, tests and runtime state',()=>{
  const files=packageJson.files.join('\n');
  for(const forbidden of ['.serena','plans/','tests/','.runtime/','docs/benchline/evidence/'])assert.equal(files.includes(forbidden),false,`forbidden ${forbidden}`);
});
