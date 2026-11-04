// Opt-in real Konnect schematic fixture. Protected CAD is written only by MCP.
// No native board mutation, credentials, network sourcing, or physical operation.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, mkdir} from 'node:fs/promises';
import {resolve, join, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {unpack} from '../../server/konnect.mjs';

assert.equal(process.argv[2], '--run-disposable-reference');
assert.equal(process.argv.length, 4);
assert.ok(isAbsolute(process.argv[3]));
const q = JSON.parse(await readFile(process.argv[3], 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
for (const key of ['binary', 'cli']) {
  assert.ok(isAbsolute(q[key]));
  assert.equal(sha(await readFile(q[key])), q[`${key}Sha256`], `${key} qualification changed`);
}
assert.ok(Array.isArray(q.assets) && q.assets.length > 0);
for (const asset of q.assets) {
  assert.ok(isAbsolute(asset.path));
  assert.equal(sha(await readFile(asset.path)), asset.sha256, 'Library input changed');
}
await mkdir(resolve('.runtime'), {recursive:true});
const root = await mkdtemp(resolve('.runtime/bl08-reference-'));
const project = join(root, 'reference');
const schematic = join(project, 'BenchlinePassiveReference.kicad_sch');
const config = join(root, 'konnect.toml');
await writeFile(config, [
  `kicad_cli = ${JSON.stringify(q.cli)}`,
  `ipc_address = ${JSON.stringify(`ipc://${root}/absent-api.sock`)}`,
  `project_dir = ${JSON.stringify(project)}`,
  'transport = "stdio"', 'auto_load_toolsets = false', 'eager_toolsets = false', ''
].join('\n'), {flag:'wx', mode:0o600});
const report = {at:new Date().toISOString(), root, project, schematic, passed:false,
  scope:'Real disposable schematic authoring and exports; board/native/physical acceptance incomplete',
  qualification:q, calls:[], findings:[], stage:'connect'};
const client = new Client({name:'benchline-electronics-reference-probe', version:'1.0.0'});
const transport = new StdioClientTransport({command:q.binary, args:['--config', config],
  env:{PATH:process.env.PATH}, stderr:'pipe'});
transport.stderr?.on('data', ()=>{});
async function call(name, args={}) {
  const entry = {name, args, startedAt:new Date().toISOString()};
  report.calls.push(entry);
  try {
    const raw = await client.callTool({name, arguments:args}, undefined, {timeout:180000});
    entry.result = unpack({...raw,isError:false});
    entry.isError = raw.isError === true;
    if (entry.isError) throw Error(`${name}: ${JSON.stringify(entry.result)}`);
    return entry.result;
  } catch(error) { entry.error = error.message; throw error; }
  finally { entry.finishedAt = new Date().toISOString(); await checkpoint(); }
}
async function checkpoint() {
  await writeFile(join(root, 'receipt.json'), JSON.stringify(report, null, 2)+'\n', {mode:0o600});
}
try {
  await client.connect(transport);
  report.server = client.getServerVersion();
  report.cliVersion = execFileSync(q.cli, ['version'], {encoding:'utf8'}).trim();
  report.catalog = await call('list_toolboxes');
  await call('get_active_toolsets');
  await call('load_user_config');
  await call('load_toolset', {name:['sch_components','sch_batch','sch_wiring','sch_analysis','sch_export','library']});
  const schemas = (await client.listTools()).tools;
  await writeFile(join(root, 'schemas.json'), JSON.stringify(schemas, null, 2)+'\n', {flag:'wx', mode:0o600});
  report.schemasSha256 = sha(JSON.stringify(schemas));
  for (const [query, id] of [['R','Device:R'],['Conn_01x03','Connector_Generic:Conn_01x03']]) {
    const found = await call('search_symbols', {query,limit:10});
    if (!found.results.some(r=>r.id===id)) {
      const [library,name] = id.split(':');
      const asset = q.assets.find(a=>a.path.endsWith(`/${library}.kicad_sym`));
      assert.ok(asset, 'Exact source library must be pinned');
      const listed = await call('list_symbols_in_library', {library_path:asset.path,limit:10000});
      assert.equal(listed.truncated,false);
      assert.ok(listed.symbols.includes(name), `Exact source library must contain ${id}`);
      report.findings.push({operation:'search_symbols',id,disposition:'Bounded name search did not include the exact ID; exact pinned library listing and symbol lookup verified it.'});
    }
    await call('get_symbol_info', {lib_id:id});
  }
  const resistor = 'Resistor_SMD:R_0603_1608Metric';
  const header = 'Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical';
  for (const id of [resistor,header]) {
    const found = await call('search_footprints', {query:id.split(':')[1],limit:10});
    assert.ok(found.results.some(r=>r.id===id));
    await call('get_footprint_info', {footprint_path:id,include_graphics:true});
  }
  report.stage = 'create';
  await call('create_project', {path:project,name:'BenchlinePassiveReference'});
  await call('batch_place_components', {schematic, components:[
    {lib_id:'Connector_Generic:Conn_01x03', reference:'J1', value:'PASSIVE TEST ONLY', x:76.2,y:76.2,rotation:180},
    {lib_id:'Device:R',reference:'R1',value:'10k',x:114.3,y:66.04},
    {lib_id:'Device:R',reference:'R2',value:'10k',x:114.3,y:86.36}
  ]});
  await call('batch_edit_schematic_components', {schematic,edits:[
    {reference:'J1',footprint:header,fields:{Fixture:'Unpowered native tool qualification'}},
    {reference:'R1',footprint:resistor}, {reference:'R2',footprint:resistor}
  ]});
  report.fieldPositionPlan = await call('reset_schematic_field_positions', {schematic,dry_run:true});
  await call('reset_schematic_field_positions', {schematic,dry_run:false});
  report.componentsBeforeWiring = await call('list_schematic_components', {schematic});
  for (const [net_name,pairs] of [
    ['TEST_IN',[['J1','1'],['R1','1']]],
    ['TEST_MID',[['J1','2'],['R1','2'],['R2','1']]],
    ['TEST_RETURN',[['J1','3'],['R2','2']]]
  ]) await call('batch_connect_to_net', {schematic,net_name,pins:pairs.map(([reference,pin_number])=>({reference,pin_number}))});
  report.stage = 'verify';
  // Explicit references are already assigned; retain any annotation failure.
  try { await call('annotate_schematic', {schematic}); }
  catch(error) { report.findings.push({operation:'annotate_schematic',disposition:'All three references were explicitly assigned; verify the exported netlist.',error:error.message}); }
  report.components = await call('list_schematic_components', {schematic});
  assert.equal(report.components.count,3);
  report.orphans = await call('find_orphan_items', {schematic});
  report.overlaps = await call('check_schematic_overlaps', {schematic});
  report.connectivity = await call('export_netlist_summary', {schematic});
  assert.equal(report.connectivity.net_count,3);
  assert.deepEqual(report.connectivity.components.flatMap(c=>c.pins.map(p=>`${c.reference}.${p.number}=${p.net}`)).sort(),
    ['J1.1=TEST_IN','J1.2=TEST_MID','J1.3=TEST_RETURN','R1.1=TEST_IN','R1.2=TEST_MID','R2.1=TEST_MID','R2.2=TEST_RETURN']);
  await call('generate_netlist', {schematic,output:join(root,'reference.net')});
  report.erc = await call('run_erc', {schematic,severity:'info',output:join(root,'erc.json')});
  assert.equal(report.orphans.orphan_count,0);
  assert.equal(report.overlaps.overlap_count,0);
  assert.deepEqual(report.overlaps.bounds_unresolved,[]);
  assert.equal(report.erc.total,0,'Retain every ERC finding; this passive fixture expects none');
  report.render = await call('render_schematic_png', {schematic,output:join(root,'schematic.png'),width_px:2400});
  report.hashes = {};
  for (const name of ['BenchlinePassiveReference.kicad_sch','BenchlinePassiveReference.kicad_pcb','BenchlinePassiveReference.kicad_pro']) {
    report.hashes[name] = sha(await readFile(join(project,name)));
  }
  for (const name of ['reference.net','erc.json','schematic.png']) report.hashes[name] = sha(await readFile(join(root,name)));
  report.stage = 'exports-created-awaiting-inspection';
  report.passed = true; // Procedure completion only; ERC/render inspection remains explicit.
} catch(error) {report.error=error.message;process.exitCode=1;}
finally {
  try {await client.close();report.transportClosed=true;} catch(error) {report.closeError=error.message;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await checkpoint();
  console.log(JSON.stringify({passed:report.passed,stage:report.stage,error:report.error,receipt:join(root,'receipt.json')}));
}
