(function(root){
 const M=typeof module==='object'?require('./ontology-model'):root.OntologyModel;
 function children(project,id){return project.relations.filter(r=>['part_of','revision_of'].includes(r.type)&&r.to===id).map(r=>M.byId(project,r.from)).filter(e=>M.isProductPart(e)&&e.status!=='archived');}
 function isFinal(project,part){return M.isProductPart(part)&&part.status!=='archived'&&!children(project,part.id).length;}
 function list(project){return project.entities.filter(p=>isFinal(project,p)).sort((a,b)=>label(a).localeCompare(label(b)));}
 function expand(project,ids){const found=new Set(),seen=new Set();function visit(id){if(seen.has(id))return;seen.add(id);const part=M.byId(project,id);if(!M.isProductPart(part))return;const next=children(project,id);if(next.length)next.forEach(p=>visit(p.id));else if(part.status!=='archived')found.add(id);}ids.forEach(visit);return [...found];}
 function label(part){let name=part?.name||'';for(const value of [part?.inOut,part?.side])if(value&&!new RegExp('(?:^|[^A-Z0-9])'+value+'(?:$|[^A-Z0-9])','i').test(name))name+=' '+value;return name;}
 const api={children,isFinal,list,expand,label};if(typeof module==='object')module.exports=api;else root.FinalParts=api;
})(globalThis);
