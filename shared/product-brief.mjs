import { z } from 'zod';

export const disciplines = [
  {id:'electronics',name:'Electronics',tool:'KiCad / Konnect',description:'Custom boards, modules, and interfaces'},
  {id:'firmware',name:'Firmware',tool:'Embedded toolchain',description:'Device behavior, drivers, and protocols'},
  {id:'mechanical',name:'Enclosure',tool:'FreeCAD',description:'Housing, mounting, and physical fit'},
  {id:'application',name:'Application',tool:'Codex',description:'A web, mobile, or desktop interface'},
];
export const emptyBrief = () => ({name:'',description:'',audience:'',stage:'prototype',disciplines:[],power:'',connectivity:'',dimensions:'',environment:'',budget:'',constraints:''});
export const briefSchema = z.object({
  name:z.string().trim().max(100), description:z.string().trim().max(4000), audience:z.string().trim().max(500),
  stage:z.enum(['prototype','pilot','production']),
  disciplines:z.array(z.enum(['electronics','firmware','mechanical','application'])).max(4).transform(v=>[...new Set(v)]),
  power:z.string().trim().max(500), connectivity:z.string().trim().max(800), dimensions:z.string().trim().max(500),
  environment:z.string().trim().max(500), budget:z.string().trim().max(500), constraints:z.string().trim().max(2000),
}).strict();

export function briefProblems(brief) {
  return [!brief.name.trim()&&'Give the product a working name.',!brief.description.trim()&&'Describe what the product needs to do.',!brief.disciplines.length&&'Choose at least one area of work.'].filter(Boolean);
}

export function proposePlan(input) {
  const b=briefSchema.parse(input),has=id=>b.disciplines.includes(id);
  const unresolved=value=>!value||/\b(tbd|unknown|undecided|not yet decided|to be determined)\b/i.test(value);
  const decisions=[];
  if(unresolved(b.audience))decisions.push({field:'audience',label:'Who will use this?',reason:'Users and use cases shape the interfaces and acceptance tests.'});
  if((has('electronics')||has('firmware'))&&unresolved(b.power))decisions.push({field:'power',label:'How is it powered?',reason:'Supply, voltage and power budget must be established before electrical design.'});
  if((has('electronics')||has('firmware')||has('application'))&&unresolved(b.connectivity))decisions.push({field:'connectivity',label:'What needs to connect?',reason:'Define physical connections and protocols before choosing parts or APIs.'});
  if(has('mechanical')&&unresolved(b.dimensions))decisions.push({field:'dimensions',label:'What must it fit around or inside?',reason:'Envelope, mounting and connector access constrain the enclosure.'});
  if(unresolved(b.environment))decisions.push({field:'environment',label:'Where will it be used?',reason:'Operating conditions affect materials, protection and testing.'});
  if(unresolved(b.budget))decisions.push({field:'budget',label:'What is the cost target?',reason:'Keep sourcing and manufacturing tradeoffs visible; no budget is assumed.'});
  const tasks=[{id:'definition',title:'Resolve requirements and acceptance tests',discipline:'product',tool:'Benchline',dependsOn:[],output:'Reviewed requirements, open decisions and measurable success criteria',check:'Owner confirms the use cases and test thresholds.'}];
  const add=(id,title,discipline,tool,dependsOn,output,check)=>tasks.push({id,title,discipline,tool,dependsOn,output,check});
  if(has('electronics')||has('firmware'))add('interfaces','Review modules and interfaces','product','Benchline research',['definition'],'Source-backed shortlist, pin/protocol map and supply assumptions','Verify manufacturer documentation, availability and reuse rights.');
  if(has('electronics'))add('electronics','Design the circuit and PCB','electronics','KiCad / Konnect',['interfaces'],'Editable schematic, PCB and initial bill of materials','Review connectivity, electrical rules, layout and saved-file checks.');
  if(has('firmware'))add('firmware','Implement and build device firmware','firmware','Embedded toolchain',['interfaces'],'Versioned firmware, interface contract and offline tests','Build for the exact target; flashing requires separate approval.');
  if(has('mechanical'))add('mechanical','Design the enclosure and mounting','mechanical','FreeCAD',has('electronics')?['electronics']:['definition'],'Editable mechanical model, fit assumptions and print export','Check dimensions, connector clearance and assembly before printing.');
  if(has('application'))add('application','Build the product interface','application','Codex',has('firmware')?['firmware']:['definition'],'Application interface and a testable device/API contract','Exercise the real user journey against a simulator before hardware.');
  const implementation=tasks.filter(t=>disciplines.some(d=>d.id===t.discipline)).map(t=>t.id);
  add('integration','Verify the complete product','product','Benchline',implementation.length?implementation:['definition'],'Cross-discipline evidence and a human-assisted prototype test plan','Software checks do not replace physical measurement or certification.');
  add('handoff','Prepare the handoff package','product','Benchline',['integration'],'Reviewed design files, build instructions, BOM and known limitations','Publishing, procurement and production release need explicit decisions.');
  return {version:1,generator:'local-rules',decisions,tasks,executionEnabled:false,
    approach:[has('electronics')&&'Compare documented modules with custom circuitry before committing to a PCB.',has('firmware')&&'Define the hardware interface first; select the embedded toolchain for the chosen target.',has('mechanical')&&'Keep the enclosure editable in FreeCAD and tied to reviewed physical dimensions.',has('application')&&'Develop the application against a versioned interface and simulator.'].filter(Boolean)};
}
