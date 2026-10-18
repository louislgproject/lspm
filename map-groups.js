(function(root){
function groupGraph(graph,mode,open=[]){
  const opened=new Set(open),mapping=new Map(),groups=new Map();
  for(const e of graph.entities){
    let label='';
    if(mode==='parts'){
      const families=new Set([e.productFamily,...graph.relations.filter(r=>r.from===e.id&&r.type==='applies_to').map(r=>graph.entities.find(p=>p.id===r.to)?.productFamily)].filter(Boolean));
      // Shared activities stay visible once rather than being duplicated inside several groups.
      label=families.size===1?[...families][0]:'';
    }
    if(mode==='departments')label=e.department||'';
    if(mode==='spaces'&&e.type==='Resource'&&e.resourceKind==='facility')label=e.name;
    // Machine sets require explicit recorded grouping, never infer interchangeability from names.
    if(mode==='machines'&&e.type==='Resource')label=e.machineSet||'';
    const id=label?'group:'+mode+':'+label:e.id;
    mapping.set(e.id,opened.has(id)?e.id:id);
    if(label){if(!groups.has(id))groups.set(id,[]);groups.get(id).push(e);}
  }
  const entities=graph.entities.filter(e=>mapping.get(e.id)===e.id);
  for(const [id,members] of groups)if(!opened.has(id))entities.push({id,type:'Work Item',name:id.split(':').slice(2).join(':'),status:'active',groupId:id,summaryCount:members.length,context:members.length+' objects · click to expand'});
  const edges=new Map();
  for(const r of graph.relations){const from=mapping.get(r.from),to=mapping.get(r.to);if(!from||!to||from===to)continue;const key=from+'|'+r.type+'|'+to;if(!edges.has(key))edges.set(key,{...r,from,to});}
  return {...graph,entities,relations:[...edges.values()],summary:false,groups};
}
function universalGraph(graph,collapsed=[],catalog=graph){
  const groups=new Map(),owner=new Map(),entitiesById=new Map(catalog.entities.map(e=>[e.id,e]));
  const members=new Map();
  for(const r of catalog.relations)if(r.type==='member_of'&&(!r.reviewState||r.reviewState==='confirmed')&&entitiesById.get(r.from)?.type==='Person'&&entitiesById.get(r.to)?.type==='Organization'){
    if(!members.has(r.from))members.set(r.from,new Set());members.get(r.from).add(r.to);
  }
  const teams=new Set([...members.values()].filter(ids=>ids.size===1).flatMap(ids=>[...ids]));
  for(const e of graph.entities){
    let kind='',label='';
    const team=e.type==='Organization'&&teams.has(e.id)?e:members.get(e.id)?.size===1?entitiesById.get([...members.get(e.id)][0]):null;
    if(team){kind='Team';label=team.name;}
    else if(e.type==='Person'&&e.department){kind='Department';label=e.department;}
    else if(e.type==='Resource'&&e.resourceKind==='facility'){kind='Space';label=e.name;}
    else if(e.type==='Resource'&&e.machineSet){kind='Machine set';label=e.machineSet;}
    else if(e.type!=='Resource'&&e.type!=='Person'&&e.type!=='Organization'){
      const families=new Set([e.productFamily,...catalog.relations.filter(r=>r.from===e.id&&['applies_to','part_of'].includes(r.type)).map(r=>entitiesById.get(r.to)?.productFamily)].filter(Boolean));
      if(families.size===1){kind='Part family';label=[...families][0];}
    }
    if(!label)continue;
    const id='universal:'+kind+':'+(team?team.id:label);owner.set(e.id,id);
    if(!groups.has(id))groups.set(id,{id,name:label,kind,members:[]});groups.get(id).members.push(e);
  }
  const folded=new Set(collapsed),mapping=new Map(graph.entities.map(e=>[e.id,folded.has(owner.get(e.id))?owner.get(e.id):e.id]));
  const entities=graph.entities.filter(e=>mapping.get(e.id)===e.id);
  for(const g of groups.values())if(folded.has(g.id))entities.push({id:g.id,type:'Work Item',name:g.name,status:'active',groupId:g.id,summaryCount:g.members.length});
  const edges=new Map();
  for(const r of graph.relations){const from=mapping.get(r.from),to=mapping.get(r.to);if(!from||!to||from===to)continue;const key=from+'|'+r.type+'|'+to;const old=edges.get(key);if(old)old.connectionCount++;else edges.set(key,{...r,from,to,connectionCount:1});}
  return {...graph,entities,relations:[...edges.values()],groups,owner,folded,summary:false};
}
function flowGroupLayout(entities,relations,layout){
  if(!entities.some(e=>e.type==='Production Step'))return layout(entities,relations);
  const F=typeof module==='object'?require('./workflow'):root.PMWorkflow;
  const parts=entities.filter(e=>['Part','Part Revision'].includes(e.type)&&e.itemKind!=='component');
  const nodes=entities.map(entity=>({id:entity.id,entity,partIds:relations.filter(r=>r.from===entity.id&&r.type==='applies_to').map(r=>r.to)}));
  const base=F.productionContextLayout({entities,relations},{nodes,edges:relations,parts});
  const positions=Object.fromEntries(Object.entries(base.positions).map(([id,p])=>[id,{x:p.x*1.3,y:p.y*1.7}]));
  const placed=new Set();
  for(const satellite of base.satellites){
    const id=satellite.entity.id;if(!positions[id]||placed.has(id))continue;
    const candidate={x:satellite.x*1.3,y:satellite.y*1.7};
    const blocked=Object.entries(positions).some(([other,p])=>other!==id&&candidate.x<p.x+220&&candidate.x+220>p.x&&candidate.y<p.y+94&&candidate.y+94>p.y);
    if(!blocked){positions[id]=candidate;placed.add(id);}
  }
  return {positions,width:Math.max(base.width*1.3,...Object.values(positions).map(p=>p.x+268)),height:Math.max(base.height*1.7,...Object.values(positions).map(p=>p.y+142))};
}
function universalLayout(graph,layout){
  const positions={},frames=[],blocks=[];
  for(const g of graph.groups.values()){
    if(graph.folded.has(g.id)){blocks.push({id:g.id,kind:g.kind,width:268,height:142,positions:{[g.id]:{x:24,y:24}}});continue;}
    const ids=new Set(g.members.map(e=>e.id));
    const inner=flowGroupLayout(g.members,graph.relations.filter(r=>ids.has(r.from)&&ids.has(r.to)),layout);
    blocks.push({id:g.id,name:g.name,kind:g.kind,width:inner.width+32,height:inner.height+64,positions:Object.fromEntries(Object.entries(inner.positions).map(([id,p])=>[id,{x:p.x+16,y:p.y+48}]))});
  }
  const loose=graph.entities.filter(e=>!graph.owner.has(e.id)&&!e.groupId);
  if(loose.length){const inner=layout(loose,graph.relations.filter(r=>loose.some(e=>e.id===r.from)&&loose.some(e=>e.id===r.to)));blocks.push({...inner,id:'loose',kind:'Related'});}
  blocks.sort((a,b)=>groupPriority(a.kind)-groupPriority(b.kind)||(a.name||a.id).localeCompare(b.name||b.id));
  // Deterministic shelves reserve the full group bounds; recomputed after every toggle.
  const target=Math.max(1600,...blocks.map(b=>b.width+64));let x=32,y=32,rowHeight=0,width=320;
  for(const b of blocks){if(x>32&&x+b.width>target){y+=rowHeight+48;x=32;rowHeight=0;}for(const [id,p] of Object.entries(b.positions))positions[id]={x:p.x+x,y:p.y+y};if(b.name)frames.push({...b,x,y});x+=b.width+48;rowHeight=Math.max(rowHeight,b.height);width=Math.max(width,x);}
  return {positions,frames,width,height:Math.max(240,y+rowHeight+48)};
}
function workflow(){return typeof module==='object'?require('./workflow'):root.PMWorkflow;}
function groupPriority(kind){return ({'Part family':0,Related:1,Space:2,'Machine set':3,Team:4,Department:4})[kind]??5;}
function packBlocks(blocks){
 const positions={},satellites=[],frames=[],target=Math.max(1800,...blocks.map(b=>b.width+64));let x=32,y=32,rowHeight=0,width=480;
 for(const block of blocks){
  if(x>32&&x+block.width>target){y+=rowHeight+48;x=32;rowHeight=0;}
  for(const [id,p]of Object.entries(block.positions))positions[id]={x:x+p.x,y:y+p.y};
  for(const s of block.satellites||[])satellites.push({...s,x:x+s.x,y:y+s.y});
  frames.push({id:block.id,name:block.name,kind:block.kind,x,y,width:block.width,height:block.height,collapsed:block.collapsed});
  x+=block.width+48;rowHeight=Math.max(rowHeight,block.height);width=Math.max(width,x);
 }
 return{positions,satellites,frames,width,height:Math.max(240,y+rowHeight+48)};
}
function networkGroups(project,network,{collapsed=[],showMachines=true,showComponents=true,layout=null}={}){
 const F=workflow(),classification=universalGraph({entities:network.nodes.map(n=>n.entity),relations:network.edges},[],project),byPart=new Map(network.parts.map(p=>[p.id,p])),groups=new Map(),owner=new Map();
 for(const n of network.nodes){
  let id=classification.owner.get(n.entity.id),group=id&&classification.groups.get(id);
  if(n.qualityViewKind){const families=new Set((n.partIds||[]).map(id=>byPart.get(id)?.productFamily).filter(Boolean));if(families.size===1){const name=[...families][0];id='universal:Part family:'+name;group={id,name,kind:'Part family'};}else id=null;}
  if(!id){id='universal:Shared context';group={id,name:'Shared context',kind:'Related'};}
  owner.set(n.id,id);if(!groups.has(id))groups.set(id,{...group,members:[]});groups.get(id).members.push(n);
 }
 const folded=new Set(collapsed),mapping=new Map(),nodes=[],blocks=[];
 const ordered=[...groups.values()].sort((a,b)=>groupPriority(a.kind)-groupPriority(b.kind)||a.name.localeCompare(b.name));
 for(const g of ordered){
  for(const n of g.members)mapping.set(n.id,folded.has(g.id)?g.id:n.id);
  if(folded.has(g.id)){
   nodes.push({id:g.id,entity:{id:g.id,type:'Work Item',name:g.name,status:'active'},groupId:g.id,groupCount:g.members.length,partIds:[...new Set(g.members.flatMap(n=>n.partIds||[]))]});
   blocks.push({id:g.id,name:g.name,kind:g.kind,collapsed:true,width:242,height:132,positions:{[g.id]:{x:24,y:48}}});continue;
  }
  nodes.push(...g.members);const ids=new Set(g.members.map(n=>n.id)),plain=g.members.filter(n=>!n.qualityViewKind);
  const inner=F.productionContextLayout(project,{nodes:plain,edges:network.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),parts:network.parts},{showMachines,showComponents});
  const positions=Object.fromEntries(Object.entries(inner.positions).map(([id,p])=>[id,{x:p.x+16,y:p.y+52}])),satellites=inner.satellites.map(s=>({...s,x:s.x+16,y:s.y+52}));let width=inner.width+32,height=inner.height+72;
  // Quality occurrences keep their own expansion layout, below the group's normal process.
  const quality=new Map();for(const n of g.members.filter(n=>n.qualityViewKind)){const key=n.partIds[0];if(!quality.has(key))quality.set(key,[]);quality.get(key).push(n);}
  let qx=24,qy=height,qh=0;
  for(const items of quality.values()){
   const available=items.filter(n=>layout?.positions[n.id]);if(!available.length)continue;
   const minX=Math.min(...available.map(n=>layout.positions[n.id].x)),minY=Math.min(...available.map(n=>layout.positions[n.id].y)),w=Math.max(...available.map(n=>layout.positions[n.id].x-minX+194)),h=Math.max(...available.map(n=>layout.positions[n.id].y-minY+60));
   if(qx>24&&qx+w>Math.max(width,1000)){qy+=qh+28;qx=24;qh=0;}
   for(const n of available)positions[n.id]={x:qx+layout.positions[n.id].x-minX,y:qy+layout.positions[n.id].y-minY};
   width=Math.max(width,qx+w+24);height=Math.max(height,qy+h+28);qx+=w+28;qh=Math.max(qh,h);
  }
  blocks.push({id:g.id,name:g.name,kind:g.kind,width,height,positions,satellites});
 }
 const edges=new Map();for(const e of network.edges){const from=mapping.get(e.from),to=mapping.get(e.to);if(!from||!to||from===to)continue;const key=from+'|'+e.type+'|'+to,old=edges.get(key);if(old){old.connectionCount++;old.partIds=[...new Set([...(old.partIds||[]),...(e.partIds||[])])];}else edges.set(key,{...e,from,to,connectionCount:1});}
 return{network:{...network,nodes,edges:[...edges.values()]},layout:packBlocks(blocks),groups};
}
function partRows(project,network,{showMachines=true,showComponents=true,collapsed=[]}={}){
 const F=workflow(),nodes=[],edges=[],positions={},satellites=[],frames=[],groups=new Map(),occurrences=new Map(),used=new Set();let y=32,width=480;
 const lanes=F.productionLanes(project,{partIds:network.parts.map(p=>p.id)}).lanes;
 const routeGroups=new Map(),partsModel=typeof module==='object'?require('./final-parts'):root.FinalParts;
 for(const part of network.parts){
  const lane=lanes.find(l=>l.id===part.id),laneItems=new Map((lane?.items||[]).map(n=>[n.id,n]));
  const route=network.nodes.filter(n=>n.entity.type==='Production Step'&&n.partIds?.includes(part.id)),ids=new Set(route.map(n=>n.id));
  if(!route.length)continue;
  const links=network.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)&&(!e.partIds?.length||e.partIds.includes(part.id)));
  // Compare the complete recorded route, machines and materials even when a
  // display toggle hides satellites. Different part-scoped inputs never merge.
  const allContext=F.productionContextLayout(project,{nodes:route,edges:links,parts:[part],partOnly:true},{showMachines:true,showComponents:true});
  const key=JSON.stringify([part.productionFamily||'',route.map(n=>[n.id,laneItems.get(n.id)?.lane||'']).sort(),links.map(e=>[e.from,e.type,e.to]).sort(),allContext.satellites.map(s=>[s.stepId,s.direction,s.kind,s.entity.id,s.relation?.quantity??null,s.relation?.unit||'']).sort(),project.relations.filter(r=>r.type==='operated_in'&&ids.has(r.from)).map(r=>[r.from,r.to]).sort()]);
  if(!routeGroups.has(key))routeGroups.set(key,[]);routeGroups.get(key).push(part);
 }
 for(const members of routeGroups.values()){
  const part=members[0],partIds=members.map(p=>p.id);
  const lane=lanes.find(l=>l.id===part.id),laneItems=new Map((lane?.items||[]).map(n=>[n.id,n]));
  const original=network.nodes.filter(n=>n.entity.type==='Production Step'&&n.partIds?.includes(part.id)).map(n=>({...n,unconfirmed:laneItems.has(n.id)?laneItems.get(n.id).lane==='unconfirmed':n.unconfirmed}));if(!original.length)continue;
  const ids=new Set(original.map(n=>n.id)),rowEdges=network.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)&&(!e.partIds?.length||e.partIds.includes(part.id)));
  const context=F.productionContextLayout(project,{nodes:original,edges:rowEdges,parts:[part],partOnly:true},{showMachines,showComponents});
  const order=new Map((lanes.find(l=>l.id===part.id)?.items||[]).map(n=>[n.id,n.order]));
  const main=original.filter(n=>!F.isSubprocess(n.entity)&&!['NG storage','Scrap'].includes(n.entity.productionStage)&&!n.unconfirmed).sort((a,b)=>(order.get(a.id)||0)-(order.get(b.id)||0));
  const mainIds=new Set(main.map(n=>n.id)),side=original.filter(n=>!mainIds.has(n.id)),maxInput=Math.max(0,...main.map(n=>context.satellites.filter(s=>s.stepId===n.id&&s.direction==='input').length)),maxOutput=Math.max(0,...main.map(n=>context.satellites.filter(s=>s.stepId===n.id&&s.direction==='output').length));
  const mainY=y+68+maxInput*59,rowPositions=new Map();main.forEach((n,i)=>rowPositions.set(n.id,{x:32+i*256,y:mainY}));
  let bottom=mainY+88+maxOutput*59;
  let sideY=bottom;
  for(let i=0;i<side.length;i+=4){const batch=side.slice(i,i+4);batch.forEach((n,j)=>rowPositions.set(n.id,{x:32+j*256,y:sideY}));sideY+=Math.max(...batch.map(n=>88+context.satellites.filter(s=>s.stepId===n.id).length*59),106);}
  for(const n of original){const id='part-view:'+part.id+':'+n.id,p=rowPositions.get(n.id);positions[id]=p;nodes.push({...n,id,partIds});used.add(n.id);if(!occurrences.has(n.id))occurrences.set(n.id,[]);occurrences.get(n.id).push(id);}
  for(const e of rowEdges)edges.push({...e,from:'part-view:'+part.id+':'+e.from,to:'part-view:'+part.id+':'+e.to,partIds});
  for(const n of original){const items=context.satellites.filter(s=>s.stepId===n.id),p=rowPositions.get(n.id);for(const direction of ['input','output'])items.filter(s=>s.direction===direction).forEach((s,i)=>satellites.push({...s,stepId:'part-view:'+part.id+':'+n.id,partIds,x:p.x,y:mainIds.has(n.id)?direction==='input'?y+64+i*59:mainY+88+i*59:p.y+80+items.indexOf(s)*59}));}
  const rowSatellites=satellites.filter(s=>s.partIds.includes(part.id)),rowWidth=Math.max(320,...original.map(n=>rowPositions.get(n.id).x+226));
  const rowBottom=Math.max(sideY,...rowSatellites.map(s=>s.y+76));
  const modelNames=[...new Set(members.map(p=>partsModel.model(project,p).name))];
  frames.push({name:members.length>1?modelNames.join(' / ')+' · '+members.length+' 세부 파츠':part.name,kind:'Model',partIds,x:16,y,width:rowWidth+16,height:rowBottom-y,static:true});width=Math.max(width,rowWidth+48);y=rowBottom+48;
 }
 const materialIds=new Set(satellites.map(s=>s.entity.id));
 for(const s of satellites)if(!positions[s.entity.id])positions[s.entity.id]={x:s.x,y:s.y};
 const support=network.nodes.filter(n=>!used.has(n.id)&&(!materialIds.has(n.entity.id))&&(showComponents||!['Part','Part Revision'].includes(n.entity.type)));
 if(support.length){
  const ids=new Set(support.map(n=>n.id)),grouped=networkGroups(project,{...network,nodes:support,edges:network.edges.filter(e=>ids.has(e.from)&&ids.has(e.to))},{collapsed,showMachines,showComponents});
  for(const [id,g]of grouped.groups)groups.set(id,g);
  nodes.push(...grouped.network.nodes);edges.push(...grouped.network.edges);
  for(const [id,p]of Object.entries(grouped.layout.positions))positions[id]={x:p.x,y:p.y+y};
  for(const f of grouped.layout.frames)frames.push({...f,y:f.y+y});
  const supportMap=new Map();for(const n of support){const group=[...grouped.groups.values()].find(g=>g.members.some(m=>m.id===n.id));supportMap.set(n.id,collapsed.includes(group.id)?group.id:n.id);}
  for(const e of network.edges){const source=occurrences.get(e.from),target=occurrences.get(e.to);if(source&&supportMap.has(e.to))for(const from of source)edges.push({...e,from,to:supportMap.get(e.to)});else if(target&&supportMap.has(e.from))for(const to of target)edges.push({...e,from:supportMap.get(e.from),to});else if(materialIds.has(e.from)&&supportMap.has(e.to))edges.push({...e,to:supportMap.get(e.to)});else if(materialIds.has(e.to)&&supportMap.has(e.from))edges.push({...e,from:supportMap.get(e.from)});}
  width=Math.max(width,grouped.layout.width);y+=grouped.layout.height;
 }
 return{network:{...network,nodes,edges},layout:{positions,satellites,frames,horizontal:true,width,height:Math.max(240,y)},groups};
}
const api={groupGraph,universalGraph,universalLayout,flowGroupLayout,networkGroups,partRows};
if(typeof module==='object')module.exports=api;else root.MapGroups=api;
})(typeof globalThis==='object'?globalThis:this);
