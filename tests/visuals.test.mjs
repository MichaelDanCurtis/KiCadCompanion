import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageProcessor, Catalog } from '@a2ui/web_core/v0_9';
import { chartSchema, tableSchema, networkSchema, visualMessages, CATALOG_ID } from '../shared/visuals.mjs';
const catalog = new Catalog(CATALOG_ID, [
  {name:'Chart',schema:chartSchema}, {name:'DataTable',schema:tableSchema}, {name:'Network',schema:networkSchema},
]);
test('real A2UI processor accepts chart, table and graph surfaces and replaces one by id', () => {
  const p = new MessageProcessor([catalog]);
  const chart = {id:'inventory',kind:'Chart',spec:{title:'Parts',source:'Live IPC test fixture',type:'bar',data:[{label:'R',value:5}]}};
  p.processMessages(visualMessages(chart));
  p.processMessages(visualMessages({id:'pads',kind:'DataTable',spec:{title:'Pads',source:'Live IPC test fixture',columns:['Pad','Net'],rows:[['1','GND']]}}));
  p.processMessages(visualMessages({id:'nets',kind:'Network',spec:{title:'Connections',source:'Live IPC test fixture',nodes:[{id:'a',label:'U1'},{id:'b',label:'C1'}],edges:[{from:'a',to:'b'}]}}));
  p.processMessages(visualMessages({...chart,spec:{...chart.spec,data:[{label:'R',value:6}]}}, {existing:true}));
  assert.equal(p.model.surfacesMap.size,3);
  assert.ok(p.model.surfacesMap.get('inventory'));
});
test('visual contracts reject code, missing sources, non-finite numbers and dangling edges', () => {
  const base={id:'a',kind:'Chart',spec:{title:'Parts',source:'Test fixture',type:'bar',data:[{label:'R',value:5}]}};
  assert.throws(()=>visualMessages({...base,kind:'Script'}));
  assert.throws(()=>visualMessages({...base,spec:{...base.spec,onClick:'alert(1)'}}));
  assert.throws(()=>visualMessages({...base,spec:{...base.spec,source:undefined}}));
  assert.throws(()=>visualMessages({...base,spec:{...base.spec,data:[{label:'R',value:Infinity}]}}));
  assert.throws(()=>visualMessages({id:'a',kind:'Network',spec:{title:'Graph',source:'Test fixture',nodes:[{id:'a',label:'A'}],edges:[{from:'a',to:'missing'}]}}));
});
