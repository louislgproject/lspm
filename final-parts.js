(function(root){
 const M=typeof module==='object'?require('./ontology-model'):root.OntologyModel;
 const dimensions=part=>new Set((label(part).toUpperCase().match(/\b(?:IB|OB|RH|LH)\b/g)||[]));
 const stem=part=>label(part).toUpperCase().replace(/\b(?:IB|OB|RH|LH)\b/g,'').replace(/[^A-Z0-9가-힣]/g,'');
 function children(project,id){
  const base=M.byId(project,id),declared=new Set(project.relations.filter(r=>['part_of','revision_of'].includes(r.type)&&r.to===id).map(r=>r.from)),traits=dimensions(base);
  // Legacy variants can be siblings under a family. Exact model stems plus
  // explicit IB/OB/RH/LH labels still identify a finer measurement choice.
  // This view grouping never changes persisted ontology links or process routes.
  return project.entities.filter(e=>M.isProductPart(e)&&e.status!=='archived'&&(declared.has(e.id)||e.id!==id&&stem(e)===stem(base)&&dimensions(e).size>traits.size&&[...traits].every(t=>dimensions(e).has(t))));
 }
 function isFinal(project,part){return M.isProductPart(part)&&part.status!=='archived'&&part.mappingState!=='route_group'&&!children(project,part.id).length;}
 function list(project){return project.entities.filter(p=>isFinal(project,p)).sort((a,b)=>label(a).localeCompare(label(b)));}
 function expand(project,ids){const found=new Set(),seen=new Set();function visit(id){if(seen.has(id))return;seen.add(id);const part=M.byId(project,id);if(!M.isProductPart(part))return;const next=children(project,id);if(next.length)next.forEach(p=>visit(p.id));else if(part.status!=='archived'&&part.mappingState!=='route_group')found.add(id);}ids.forEach(visit);return [...found];}
 function label(part){let name=part?.name||'';for(const value of [part?.inOut,part?.side])if(value&&!new RegExp('(?:^|[^A-Z0-9])'+value+'(?:$|[^A-Z0-9])','i').test(name))name+=' '+value;return name;}
 function model(project,part){
  const ancestors=[],seen=new Set([part.id]),queue=[part.id];
  while(queue.length){const id=queue.shift();for(const r of project.relations.filter(r=>['part_of','revision_of'].includes(r.type)&&r.from===id)){if(seen.has(r.to))continue;seen.add(r.to);const parent=M.byId(project,r.to);if(!M.isProductPart(parent))continue;queue.push(parent.id);if(!dimensions(parent).size&&parent.mappingState!=='route_group')ancestors.push(parent);}}
  const text=label(part).toLowerCase();ancestors.sort((a,b)=>Number(text.startsWith(b.name.toLowerCase()))-Number(text.startsWith(a.name.toLowerCase()))||b.name.length-a.name.length||a.id.localeCompare(b.id));
  return ancestors[0]||{...part,id:'model:'+stem(part),name:label(part).replace(/\b(?:IB|OB|RH|LH)\b/gi,'').replace(/\s+/g,' ').trim()};
 }
 function models(project,parts=list(project)){const groups=new Map();for(const part of parts){const base=model(project,part);if(!groups.has(base.id))groups.set(base.id,{id:base.id,name:base.name,productionFamily:part.productionFamily,productFamily:part.productFamily,parts:[]});groups.get(base.id).parts.push(part);}return [...groups.values()];}
 const api={children,isFinal,list,expand,label,model,models};if(typeof module==='object')module.exports=api;else root.FinalParts=api;
})(globalThis);
