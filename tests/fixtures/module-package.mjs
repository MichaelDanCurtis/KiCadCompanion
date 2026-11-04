// Invented offline data for schema/provenance tests; not an ESP32 specification.
import {randomUUID} from 'node:crypto';
export function fixtureModule(){
  const sourceId=randomUUID(),ref={sourceId,locator:'Synthetic fixture section 1'};
  const f=(value,unit=null)=>({value,unit,status:'source-verified',sources:[ref],note:'Invented test data, not engineering guidance'});
  return {schemaVersion:1,id:randomUUID(),identity:{vendor:f('Fixture vendor'),model:f('Synthetic module'),hardwareRevision:f('fixture-r1')},
    pinInventoryComplete:f(true),pins:[{id:randomUUID(),number:'1',name:f('FIXTURE_IO'),interfaces:f(['fixture-interface']),reserved:f(false),maxVoltageV:f(1,'V'),maxCurrentMA:f(1,'mA')}],
    power:{minSupplyV:f(1,'V'),maxSupplyV:f(2,'V'),maxCurrentMA:f(3,'mA')},dimensions:{widthMM:f(10,'mm'),heightMM:f(20,'mm'),depthMM:f(2,'mm')},
    assets:[{id:randomUUID(),kind:'drawing',name:'Synthetic drawing',source:ref,sha256:'b'.repeat(64),license:'Fixture only; no downloaded asset',reuseStatus:'review-required'}],
    firmware:[{id:randomUUID(),sdk:f('Fixture SDK'),version:f('fixture-v1'),source:ref}],
    sources:[{id:sourceId,title:'Invented fixture document',url:'https://manufacturer.example.invalid/fixture.pdf',version:'fixture-v1',retrievedAt:'2026-09-10T00:00:00.000Z',sha256:'a'.repeat(64),license:null}],notes:'Synthetic offline data only'};
}
export function fixtureBom(){return {schemaVersion:1,id:randomUUID(),revision:1,name:'Synthetic BOM',items:[{
  id:randomUUID(),references:['U1','U2'],manufacturer:'Fixture vendor',mpn:'SYNTHETIC-001',quantity:2,dnp:true,packaging:'tray',moduleRef:null,
  offers:[{id:randomUUID(),distributor:'Fixture distributor',sku:'FAKE-001',manufacturer:'Fixture vendor',mpn:'SYNTHETIC-001',packaging:'tray',requestedQuantity:2,
    currency:'USD',unitPrice:'1.2500',availableQuantity:5,observedAt:'2026-09-10T00:00:00.000Z',sourceUrl:'https://distributor.example.invalid/fixture',sourceHash:'c'.repeat(64),substitute:false}],
  proposedSubstitutes:[{manufacturer:'Other fixture vendor',mpn:'NOT-APPROVED',reason:'Proposed example only'}],
}]};}
