import {z} from 'zod';

export const artifactKinds=['electrical','firmware','mechanical','application','evidence'];
export const projectPath=z.string().min(1).max(400).refine(p=>
  !/[\\:%\x00-\x1f]/.test(p)&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!s.startsWith('.')&&!/[. ]$/.test(s)),
  'Use a normalized project-relative path without traversal, hidden directories, drive letters or URL encoding.');
const id=z.string().uuid(),text=z.string().trim().min(1).max(4000);
const node={id,name:z.string().trim().min(1).max(160),dependsOn:z.array(id).max(500)};
export const requirementSchema=z.object({...node,text,revision:z.number().int().positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const artifactSchema=z.object({...node,kind:z.enum(artifactKinds),path:projectPath}).strict();
export const manifestSchema=z.object({schemaVersion:z.literal(1),id,name:z.string().trim().min(1).max(100),revision:z.number().int().positive(),
  sourceBrief:z.object({id,revision:z.number().int().positive()}).strict().nullable(),
  requirements:z.array(requirementSchema).max(500),artifacts:z.array(artifactSchema).max(500)}).strict().superRefine((m,ctx)=>{
    const nodes=[...m.requirements,...m.artifacts],map=new Map();
    for(const n of nodes){if(map.has(n.id))ctx.addIssue({code:'custom',message:'Duplicate node ID'});map.set(n.id,n);if(new Set(n.dependsOn).size!==n.dependsOn.length)ctx.addIssue({code:'custom',message:'Duplicate dependency'});}
    if(map.has(m.id))ctx.addIssue({code:'custom',message:'Project and node IDs must be distinct'});
    const paths=m.artifacts.map(a=>a.path.toLowerCase());if(new Set(paths).size!==paths.length)ctx.addIssue({code:'custom',message:'Duplicate artifact locator'});
    for(const a of m.artifacts)if(a.path.toLowerCase()==='benchline.project.json')ctx.addIssue({code:'custom',message:'The project manifest cannot be its own artifact'});
    const seen=new Set(),active=new Set();
    function visit(key){if(active.has(key)){ctx.addIssue({code:'custom',message:'Dependency cycle'});return;}if(seen.has(key))return;seen.add(key);active.add(key);
      for(const dep of map.get(key)?.dependsOn||[]){if(!map.has(dep))ctx.addIssue({code:'custom',message:'Dangling dependency'});else visit(dep);}active.delete(key);}
    for(const key of map.keys())visit(key);
  });

export function impactOf(manifest,changedIds) {
  const m=manifestSchema.parse(manifest),nodes=[...m.requirements,...m.artifacts],ids=new Set(nodes.map(n=>n.id));
  if(changedIds.some(id=>!ids.has(id)))throw new Error('Unknown changed node');
  const changed=new Set(changedIds),affected=new Set(changedIds);
  let grew=true;while(grew){grew=false;for(const n of nodes)if(!affected.has(n.id)&&n.dependsOn.some(id=>affected.has(id))){affected.add(n.id);grew=true;}}
  return {changed:[...changed].sort(),downstream:nodes.filter(n=>affected.has(n.id)&&!changed.has(n.id)).map(n=>n.id).sort(),unaffected:nodes.filter(n=>!affected.has(n.id)).map(n=>n.id).sort()};
}
