import test from 'node:test';
import assert from 'node:assert/strict';
import {transformBoardPoint} from '../shared/mechanical-coordinates.mjs';

test('preserves millimetre top-side coordinates with origin',()=>{
  assert.deepEqual(transformBoardPoint({x:3,y:4,z:2},{originMM:{xMM:10,yMM:20,zMM:1}}),{xMM:13,yMM:24,zMM:3});
});

test('converts inches before applying the rotation',()=>{
  assert.deepEqual(transformBoardPoint({x:1,y:0,z:0},{units:'inch',rotationDeg:90}),{xMM:0,yMM:25.4,zMM:0});
});

test('mirrors bottom-side coordinates before rotation',()=>{
  assert.deepEqual(transformBoardPoint({x:3,y:4,z:0},{face:'bottom'}),{xMM:-3,yMM:4,zMM:0});
  assert.deepEqual(transformBoardPoint({x:3,y:4,z:0},{face:'bottom',rotationDeg:90}),{xMM:-4,yMM:-3,zMM:0});
});

test('rejects unsupported units, faces and non-finite coordinates',()=>{
  assert.throws(()=>transformBoardPoint({x:1,y:2},{units:'mil'}),/unsupported source units/);
  assert.throws(()=>transformBoardPoint({x:1,y:2},{face:'back'}),/unsupported board face/);
  assert.throws(()=>transformBoardPoint({x:Infinity,y:2}),/point.x must be finite/);
});

