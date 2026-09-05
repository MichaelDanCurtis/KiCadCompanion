import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_COLORS, DEFAULT_APPEARANCE, DEFAULT_BOARD_PALETTE, parseAppearance, boardPalette, outlinePath } from '../shared/appearance.mjs';
import { themePalette, readKiCadAppearance } from '../server/appearance.mjs';
test('appearance preferences validate and survive a serialization round trip',()=>{
  for(const boardColor of BOARD_COLORS){const saved={version:1,theme:'kicad',boardColor};assert.deepEqual(parseAppearance(JSON.parse(JSON.stringify(saved))),saved)}
  for(const invalid of [null,{}, {version:1,theme:'bad',boardColor:'url(x)'}, {version:2,boardColor:'red'}])assert.deepEqual(parseAppearance(invalid),DEFAULT_APPEARANCE);
});
test('all four finishes are distinct; KiCad layer colors remain separately selectable',()=>{
  assert.equal(new Set(BOARD_COLORS.map(c=>boardPalette(c).fill)).size,5);
  assert.equal(boardPalette('kicad',{front:'#123456'}).front,'#123456');
  assert.equal(boardPalette('red').fill,'#722b33');
  assert.equal(boardPalette('white').text,'#fffbee');
});
test('saved theme imports literal color fields and rejects executable CSS',async()=>{
  const palette=themePalette({board:{background:'url(https://invalid)',copper:{f:'rgb(12, 34, 56)',b:'#123456'},edge_cuts:'#abcdef'}});
  assert.equal(palette.background,DEFAULT_BOARD_PALETTE.background);assert.equal(palette.front,'rgb(12, 34, 56)');assert.equal(palette.back,'#123456');
  const fallback=await readKiCadAppearance('/nonexistent/companion-theme-test');assert.ok(fallback.note);assert.deepEqual(fallback.palette,DEFAULT_BOARD_PALETTE);
});
test('board finish follows real closed contours, including holes, without inventing edges',()=>{
  const edge=(a,b)=>({layer:'BL_Edge_Cuts',start:{x:a[0],y:a[1]},end:{x:b[0],y:b[1]}});
  const square=[edge([0,0],[5,0]),edge([5,5],[5,0]),edge([0,5],[0,0]),edge([5,5],[0,5])];
  assert.match(outlinePath(square),/^M .* Z$/);assert.equal(outlinePath(square.slice(1)),'');
  const hole=square.map(s=>({...s,start:{x:s.start.x/5+1,y:s.start.y/5+1},end:{x:s.end.x/5+1,y:s.end.y/5+1}}));
  assert.equal(outlinePath([...square,...hole]).split(' Z').length-1,2);
  assert.equal(outlinePath([...square,edge([0,0],[9,9])]),'');assert.equal(outlinePath([]),'');
});
