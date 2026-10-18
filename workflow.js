(function (root) {
  const M = typeof module === "object" ? require("./ontology-model.js") : root.OntologyModel;
  const Resolver = typeof module === "object" ? require("./import-resolver.js") : root.ImportResolver;
  const OBJECT_COLUMNS = ["id", "type", "name", "status", "context", ...M.TEXT_FIELDS, ...M.DATE_FIELDS];
  const RELATION_COLUMNS = ["id", "type", "from", "to", "evidence", "quantity", "unit", "basis", "routePartId", "reviewState"];
  const SCHEDULE_TYPES = ["Work Item", "Production Step", "Gate", "Build", "Deliverable", "Event"];
  const isSubprocess = e => e.processLevel === "sub" || Boolean(e.parentWorkId);
  function range(e) {
    if (e.type === "Event") return e.occurredDate ? {start:e.occurredDate,end:e.occurredDate,basis:"actual event"} : null;
    for (const basis of ["forecast", "planned"]) {
      const start = e[basis + "Start"], end = e[basis + "End"];
      if (start || end) return {start:start || end,end:end || start,basis};
    }
    return e.due ? {start:e.due,end:e.due,basis:"due"} : null;
  }
  function overlaps(e, start, end) {
    const r = range(e);
    return !r || ((!start || r.end >= start) && (!end || r.start <= end));
  }
  function ganttWindow(items,start,end,scale='month') {
    const day=86400000,days=Math.round((Date.parse(end)-Date.parse(start))/day)+1,step=scale==='week'?1:scale==='quarter'?30:7;
    const segment=value=>{
      if(!value||value.end<start||value.start>end)return null;
      const clippedStart=value.start<start?start:value.start,clippedEnd=value.end>end?end:value.end;
      return {left:(Date.parse(clippedStart)-Date.parse(start))/day/days*100,width:(Math.round((Date.parse(clippedEnd)-Date.parse(clippedStart))/day)+1)/days*100,start:value.start,end:value.end,basis:value.basis};
    };
    const projected=items.map(item=>{
      const current=range(item),baseline=(item.baselineStart||item.baselineEnd)?{start:item.baselineStart||item.baselineEnd,end:item.baselineEnd||item.baselineStart,basis:'baseline'}:null;
      const actual=(item.actualStart||item.actualEnd)?{start:item.actualStart||item.actualEnd,end:item.actualEnd||item.actualStart,basis:'actual'}:null;
      return {id:item.id,current:segment(current),baseline:segment(baseline),actual:segment(actual),late:Boolean(current&&baseline&&current.end>baseline.end),milestone:Boolean(current&&(item.type==='Gate'||current.start===current.end))};
    });
    const ticks=[];for(let offset=0;offset<days;offset+=step){const date=new Date(Date.parse(start)+offset*day);ticks.push({left:offset/days*100,label:scale==='quarter'?date.toLocaleDateString('en',{month:'short'}):String(date.getUTCDate())});}
    return {start,end,days,ticks,items:projected};
  }
  function downstream(project, id) {
    const found = new Set(id ? [id] : []), queue = [...found];
    for (let i = 0; i < queue.length; i++) {
      project.relations.filter(r => r.type === "precedes" && r.from === queue[i]).forEach(r => {
        if (!found.has(r.to)) { found.add(r.to); queue.push(r.to); }
      });
    }
    return found;
  }
  function localGraph(project,centerId,{depth=1,direction='all',types=[],limit=24}={}) {
    const found=new Set(centerId?[centerId]:[]),queue=centerId?[{id:centerId,level:0}]:[];
    for(let i=0;i<queue.length;i++){
      const current=queue[i];if(current.level>=depth)continue;
      for(const relation of project.relations){
        if(types.length&&!types.includes(relation.type))continue;
        const outgoing=relation.from===current.id,incoming=relation.to===current.id;
        if(direction==='outgoing'&&!outgoing||direction==='incoming'&&!incoming||direction==='all'&&!outgoing&&!incoming)continue;
        const next=outgoing?relation.to:relation.from;if(!found.has(next)){found.add(next);queue.push({id:next,level:current.level+1});}
      }
    }
    const all=[...found],kept=new Set(all.slice(0,limit)),nodes=all.slice(0,limit).map(id=>M.byId(project,id)).filter(Boolean);
    return {center:M.byId(project,centerId),nodes,relations:project.relations.filter(r=>kept.has(r.from)&&kept.has(r.to)&&(types.length?types.includes(r.type):true)),truncated:Math.max(0,all.length-limit)};
  }
  function neighborhood(project, id) {
    const hierarchy=project.entities.filter(e=>e.parentWorkId&&(e.id===id||e.parentWorkId===id)).flatMap(e=>[e.id,e.parentWorkId]);
    return new Set([id, ...M.relationsFor(project, id).flatMap(r => [r.from, r.to]),...hierarchy]);
  }
  function projectGraph(project, options = {}) {
    const history=typeof module==='object'?require('./history'):globalThis.EventHistory;
    if(history)project=history.structure(project);
    const {types, query = "", status = "", start, end, focus, selectedId, keepPredecessors = false} = options;
    const scope = focus === "downstream" ? downstream(project, selectedId) : focus === "direct" ? neighborhood(project, selectedId) : null;
    const matches = M.search(project, query).filter(e => (!types || types.includes(e.type)) && (!status || e.status === status) && (!scope || scope.has(e.id)) && (options.showSubprocesses !== false || !isSubprocess(e)));
    const entities = matches.filter(e => overlaps(e, start, end)), ids = new Set(entities.map(e => e.id)), context = new Set();
    if (keepPredecessors && (start || end)) {
      // Only date filtering is relaxed. Type/search/status/focus constraints remain strict.
      let added = true;
      while (added) {
        added = false;
        for (const r of project.relations) if (r.type === "precedes" && ids.has(r.to) && !ids.has(r.from)) {
          const e = matches.find(e => e.id === r.from);
          if (e) { entities.push(e); ids.add(e.id); context.add(e.id); added = true; }
        }
      }
    }
    const structure = entities.filter(e=>e.parentWorkId && ids.has(e.parentWorkId)).map(e=>({id:'structure-'+e.id,from:e.parentWorkId,to:e.id,type:'subprocess',evidence:e.branchKind||'support'}));
    return {entities, context, relations:[...project.relations.filter(r => ids.has(r.from) && ids.has(r.to)),...structure]};
  }
  function workstreamGraph(project, code, options={}) {
    const graph=projectGraph(project,options);
    const assigned=new Set(Object.entries(project.workstreams||{}).filter(([,codes])=>codes.includes(code)).map(([id])=>id));
    const available=new Set(graph.entities.map(entity=>entity.id));
    const visible=new Set([...assigned].filter(id=>available.has(id)));
    const contextTypes=new Set(['Part','Part Revision','Person','Organization','Resource','Evidence','Assignment','Requirement','Characteristic','Issue','Risk','Event','Decision']);
    const crossTypes=new Set(['Work Item','Production Step','Gate','Deliverable','Build']);
    for(const relation of graph.relations){
      const other=assigned.has(relation.from)?relation.to:assigned.has(relation.to)?relation.from:null;
      if(!other||!available.has(other))continue;
      const entity=graph.entities.find(item=>item.id===other);
      if(contextTypes.has(entity.type)||crossTypes.has(entity.type)&&['precedes','blocks','required_for','condition_target','apqp_input_to','on_failure','rework_of','potentially_affects'].includes(relation.type))visible.add(other);
    }
    for(const relation of graph.relations){
      if(!['assignment_scope','assigned_to','revision_of','part_of'].includes(relation.type))continue;
      if(visible.has(relation.from)&&available.has(relation.to))visible.add(relation.to);
      if(visible.has(relation.to)&&available.has(relation.from))visible.add(relation.from);
    }
    const entities=graph.entities.filter(entity=>visible.has(entity.id));
    return {entities,relations:graph.relations.filter(relation=>visible.has(relation.from)&&visible.has(relation.to)),context:new Set([...graph.context].filter(id=>visible.has(id))),boundary:new Set(entities.filter(entity=>!assigned.has(entity.id)&&crossTypes.has(entity.type)).map(entity=>entity.id))};
  }
  function workstreamRecords(project, code) {
    return workstreamGraph(project,code).entities.filter(e=>e.status!=='archived');
  }
  function relatedRisks(project, entityId) {
    const targets=new Set([entityId]);
    // Only immediate operational context; never fan out through a shared asset.
    for(const r of project.relations){
      if(!['applies_to','consumes','produces','requires','assignment_scope'].includes(r.type))continue;
      const other=r.from===entityId?r.to:r.to===entityId?r.from:null;
      if(['Production Step','Work Item','Gate'].includes(M.byId(project,other)?.type))targets.add(other);
      if(r.from===entityId&&r.type==='requires'&&['Production Step','Work Item'].includes(M.byId(project,entityId)?.type)&&M.byId(project,r.to)?.type==='Resource')targets.add(r.to);
    }
    const ids=new Set(project.relations.filter(r=>r.type==='potentially_affects'&&targets.has(r.to)).map(r=>r.from));
    return project.entities.filter(e=>ids.has(e.id)&&['Risk','Issue'].includes(e.type)&&e.status!=='archived');
  }
  // Explicit line/process links only. Both firstContacts have priority 1; managers are later escalation.
  function reportingContacts(project,entityId) {
    const byId=new Map(project.entities.filter(e=>e.status!=='archived').map(e=>[e.id,e]));
    const relations=project.relations.filter(r=>(project.id==='library'||!r.scopeProjectId||r.scopeProjectId===project.id)&&byId.has(r.from)&&byId.has(r.to)&&(!r.reviewState||r.reviewState==='confirmed')).slice().sort((a,b)=>a.id.localeCompare(b.id));
    const isLine=e=>e?.type==='Resource'&&e.resourceKind==='line';
    const used=new Map(),remember=r=>used.set(r.id,r),sort=items=>items.slice().sort((a,b)=>a.id.localeCompare(b.id));
    const result={entityId,status:'unknown',line:null,lines:[],entryMode:'either',firstContacts:[],laterManagers:[],relations:[]};
    let entity=byId.get(entityId);const visited=new Set();
    if(['Part','Part Revision'].includes(entity?.type)){
      // A recorded line output establishes line responsibility for the part,
      // including intermediate components. Do not infer people from its name.
      let parts=new Set([entity.id]);const seen=new Set(parts);
      while(parts.size){
        const outputs=relations.filter(r=>r.type==='produces'&&parts.has(r.to)&&isLine(byId.get(r.from)));
        if(outputs.length){outputs.forEach(remember);result.lines=sort([...new Set(outputs.map(r=>r.from))].map(id=>byId.get(id)));break;}
        const parents=relations.filter(r=>['part_of','revision_of'].includes(r.type)&&parts.has(r.from)&&['Part','Part Revision'].includes(byId.get(r.to)?.type)&&!seen.has(r.to));
        parents.forEach(remember);parts=new Set(parents.map(r=>r.to));parts.forEach(id=>seen.add(id));
      }
    }
    while(entity&&!isLine(entity)&&!visited.has(entity.id)){
      visited.add(entity.id);
      if(!['Production Step','Work Item'].includes(entity.type))break;
      const links=relations.filter(r=>r.from===entity.id&&['operated_in','requires'].includes(r.type)&&isLine(byId.get(r.to)));
      if(links.length){links.forEach(remember);result.lines=sort([...new Set(links.map(r=>r.to))].map(id=>byId.get(id)));break;}
      entity=byId.get(entity.parentWorkId);
    }
    if(isLine(entity))result.lines=[entity];
    const roots=new Set();let cycle=false;
    function ascend(id,path=new Set()) {
      if(path.has(id)){cycle=true;return;}
      const parents=relations.filter(r=>r.type==='part_of'&&r.from===id&&isLine(byId.get(r.to)));
      if(!parents.length){roots.add(id);return;}
      for(const r of parents){remember(r);ascend(r.to,new Set([...path,id]));}
    }
    result.lines.forEach(line=>ascend(line.id));
    if(cycle||!roots.size)return result;
    if(roots.size!==1){result.status='ambiguous';return result;}
    result.line=byId.get([...roots][0]);
    const entries=relations.filter(r=>r.type==='escalates_to'&&r.from===result.line.id&&byId.get(r.to)?.type==='Organization');
    result.firstContacts=sort([...new Set(entries.map(r=>r.to))].map(id=>byId.get(id))).map(group=>{
      const members=relations.filter(r=>r.type==='member_of'&&r.to===group.id&&byId.get(r.from)?.type==='Person');
      members.forEach(remember);
      return {group,priority:1,members:sort([...new Set(members.map(r=>r.from))].map(id=>byId.get(id)))};
    });
    entries.forEach(remember);
    const groups=new Set(result.firstContacts.map(c=>c.group.id));
    for(const r of relations)if(r.type==='escalates_to'&&groups.has(r.from)&&groups.has(r.to))remember(r);
    const managers=relations.filter(r=>r.type==='manages'&&r.to===result.line.id&&byId.get(r.from)?.type==='Person');
    managers.forEach(remember);
    const queue=sort([...new Set(managers.map(r=>r.from))].map(id=>byId.get(id))),seen=new Set(queue.map(e=>e.id));
    for(let i=0;i<queue.length;i++){
      result.laterManagers.push(queue[i]);
      for(const r of relations.filter(r=>r.type==='reports_to'&&r.from===queue[i].id&&byId.get(r.to)?.type==='Person')){
        remember(r);if(!seen.has(r.to)){seen.add(r.to);queue.push(byId.get(r.to));}
      }
    }
    for(const r of relations)if(r.type==='escalates_to'&&groups.has(r.from)&&seen.has(r.to))remember(r);
    result.status=result.firstContacts.length?'resolved':'unknown';
    result.relations=sort([...used.values()]);
    return result;
  }
  function productionGraph(project, {partId="", layers=["parts","people","resources","gates"], query="", start="", end="", showSubprocesses=true, expandedIds=null}={}) {
    const layer=new Set(layers), parts=new Set(partId?[partId]:[]);
    if(partId && M.byId(project,partId)?.type==='Part') {
      let count=-1;
      while(count!==parts.size){count=parts.size;for(const r of project.relations)if((r.type==='revision_of'||r.type==='part_of')&&parts.has(r.to))parts.add(r.from);}
    }
    const matched=new Set(M.search(project,query).map(e=>e.id));
    const expanded=expandedIds===null?null:new Set(expandedIds);
    const candidates=project.entities.filter(e=>e.type==='Production Step' && (showSubprocesses||!isSubprocess(e)) && (!expanded||!isSubprocess(e)||expanded.has(e.parentWorkId)) && overlaps(e,start,end) &&
      (!query||matched.has(e.id)||project.relations.some(r=>r.from===e.id&&matched.has(r.to)||r.to===e.id&&matched.has(r.from))||project.relations.some(scope=>scope.type==='assignment_scope'&&scope.to===e.id&&project.relations.some(r=>r.type==='assigned_to'&&r.from===scope.from&&matched.has(r.to)))));
    const selected=new Set(candidates.filter(e=>!partId||project.relations.some(r=>r.from===e.id&&['applies_to','consumes','produces'].includes(r.type)&&parts.has(r.to))).map(e=>e.id));
    if(partId){let count=-1;while(count!==selected.size){count=selected.size;for(const e of candidates)if(e.parentWorkId&&selected.has(e.parentWorkId))selected.add(e.id);}}
    const steps=candidates.filter(e=>selected.has(e.id));
    const stepIds=new Set(steps.map(e=>e.id)), ids=new Set(stepIds), relations=[];
    const group=e=>['Part','Part Revision'].includes(e.type)?'parts':['Person','Organization'].includes(e.type)?'people':e.type==='Resource'?'resources':e.type==='Gate'?'gates':'';
    for(const r of project.relations){
      const from=M.byId(project,r.from),to=M.byId(project,r.to);
      if(partId&&r.routePartId&&!parts.has(r.routePartId))continue;
      if(stepIds.has(r.from)&&stepIds.has(r.to)) {relations.push(r);continue;}
      const other=stepIds.has(r.from)?to:stepIds.has(r.to)?from:null;
      if(other&&layer.has(group(other))) {ids.add(other.id);relations.push(r);}
    }
    if(layer.has('people')) for(const scope of project.relations.filter(r=>r.type==='assignment_scope'&&stepIds.has(r.to))){
      const assignment=M.byId(project,scope.from);
      for(const link of project.relations.filter(r=>r.type==='assigned_to'&&r.from===scope.from)){
        const person=M.byId(project,link.to);if(!person)continue;
        ids.add(person.id);relations.push({id:'staff-'+scope.id+'-'+link.id,from:person.id,to:scope.to,type:'assigned',evidence:[assignment?.raci,assignment?.role].filter(Boolean).join(' · ')});
      }
    }
    if(layer.has('parts')){let count=-1;while(count!==ids.size){count=ids.size;for(const r of project.relations)if(['revision_of','part_of'].includes(r.type)&&ids.has(r.from)){ids.add(r.to);if(!relations.some(existing=>existing.id===r.id))relations.push(r);}}}
    if(layer.has('people')) for(const r of project.relations.filter(r=>r.type==='works_at'&&ids.has(r.from)||r.type==='supplies'&&ids.has(r.to))){
      const other=M.byId(project,r.to);if(other?.type==='Organization'){ids.add(other.id);relations.push(r);}
    }
    for(const e of steps) if(e.parentWorkId&&stepIds.has(e.parentWorkId))relations.push({id:'production-parent-'+e.id,from:e.parentWorkId,to:e.id,type:'subprocess',evidence:e.branchKind||'support'});
    const mainIds=new Set(steps.filter(e=>!isSubprocess(e)).map(e=>e.id));
    const sequenced=new Set(relations.filter(r=>r.type==='precedes'&&mainIds.has(r.from)&&mainIds.has(r.to)).flatMap(r=>[r.from,r.to]));
    const unplacedIds=new Set([...mainIds].filter(id=>!sequenced.has(id)));
    return {entities:project.entities.filter(e=>ids.has(e.id)),relations,steps,unplacedIds};
  }
  function summaryEdges(relations,groupsById) {
    const counts=new Map();
    for(const relation of relations) for(const from of groupsById.get(relation.from)||[]) for(const to of groupsById.get(relation.to)||[]) {
      if(from===to)continue;
      const key=from+'\0'+to;
      counts.set(key,(counts.get(key)||0)+1);
    }
    return [...counts].map(([key,count],index)=>{
      const [from,to]=key.split('\0');
      return {id:'summary:edge:'+index,from,to,type:count+' link'+(count===1?'':'s'),count};
    });
  }
  function workstreamSummary(project,options={}) {
    const graph=projectGraph(project,options),groupsById=new Map(),counts=new Map(M.WORKSTREAMS.map(item=>[item.code,0]));
    let unassigned=0;
    for(const entity of graph.entities) {
      const codes=(project.workstreams?.[entity.id]||[]).filter(code=>counts.has(code));
      if(!codes.length){groupsById.set(entity.id,['summary:workstream:unassigned']);unassigned++;continue;}
      groupsById.set(entity.id,codes.map(code=>'summary:workstream:'+code));
      codes.forEach(code=>counts.set(code,counts.get(code)+1));
    }
    const entities=M.WORKSTREAMS.map(item=>({id:'summary:workstream:'+item.code,type:'Work Item',name:item.label,status:'active',summaryKind:'workstream',summaryCode:item.code,summaryCount:counts.get(item.code),summaryDetail:'Open '+item.label+' process'}));
    if(unassigned)entities.push({id:'summary:workstream:unassigned',type:'Work Item',name:'Unassigned',status:'unknown',summaryKind:'unassigned',summaryCount:unassigned,summaryDetail:'Classify in object details'});
    return {entities,relations:summaryEdges(graph.relations,groupsById),context:new Set(),boundary:new Set(),summary:true,matched:graph.entities.length};
  }
  function partSummary(project,options={}) {
    const graph=projectGraph(project,options),allowed=new Set(graph.entities.map(e=>e.id));
    const withoutQuery=options.query?new Set(projectGraph(project,{...options,query:''}).entities.map(e=>e.id)):allowed;
    const parts=project.entities.filter(e=>['Part','Part Revision'].includes(e.type)).sort((a,b)=>a.name.localeCompare(b.name));
    const entities=[],groupsById=new Map(),linkedStepIds=new Set();
    for(const part of parts) {
      const partMatched=Boolean(options.query&&allowed.has(part.id));
      const route=productionGraph(project,{partId:part.id,query:partMatched?'':options.query,start:options.start,end:options.end,showSubprocesses:options.showSubprocesses});
      const steps=route.steps.filter(step=>(partMatched?withoutQuery:allowed).has(step.id));
      if(!allowed.has(part.id)&&!steps.length)continue;
      const id='summary:part:'+part.id,problems=steps.filter(step=>isSubprocess(step)&&['exception','rework'].includes(step.branchKind)).length;
      entities.push({id,type:part.type,name:part.name,status:part.status,summaryKind:'part',partId:part.id,summaryCount:steps.length,summaryDetail:steps.length?`${steps.length} steps · ${problems} problem branches`:'No linked process'});
      for(const entityId of [part.id,...steps.map(step=>step.id)]) {
        const groups=groupsById.get(entityId)||[];if(!groups.includes(id))groups.push(id);groupsById.set(entityId,groups);
      }
      steps.forEach(step=>linkedStepIds.add(step.id));
    }
    const orphanIds=new Set(graph.entities.filter(e=>e.type==='Production Step'&&!linkedStepIds.has(e.id)).map(e=>e.id));
    if(orphanIds.size){
      const id='summary:part:unlinked';
      entities.push({id,type:'Production Step',name:'Unlinked steps',status:'unknown',summaryKind:'unlinked',summaryCount:orphanIds.size,summaryDetail:'No Part relation recorded'});
      orphanIds.forEach(stepId=>groupsById.set(stepId,[id]));
    }
    return {entities,relations:summaryEdges(graph.relations,groupsById),context:new Set(),boundary:new Set(),summary:true,matched:graph.entities.length};
  }
  function partFocusedGraph(project,partId,options={}) {
    const part=M.byId(project,partId);
    if(!part||!['Part','Part Revision'].includes(part.type))return {entities:[],relations:[],context:new Set(),boundary:new Set()};
    const partMatched=Boolean(options.query&&M.search(project,options.query).some(e=>e.id===partId));
    const route=productionGraph(project,{partId,layers:['parts','people','resources','gates'],query:partMatched?'':options.query,start:options.start,end:options.end,showSubprocesses:options.showSubprocesses});
    const allowed=new Set(projectGraph(project,partMatched?{...options,query:''}:options).entities.map(e=>e.id));
    const ids=new Set(route.entities.filter(e=>allowed.has(e.id)).map(e=>e.id));
    ids.add(partId);
    for(const relation of project.relations)if(relation.type==='assignment_scope'&&ids.has(relation.to)&&allowed.has(relation.from))ids.add(relation.from);
    const assignments=project.relations.filter(r=>['assignment_scope','assigned_to'].includes(r.type)&&ids.has(r.from)&&ids.has(r.to));
    return {entities:project.entities.filter(e=>ids.has(e.id)),relations:[...route.relations.filter(r=>ids.has(r.from)&&ids.has(r.to)),...assignments],steps:route.steps.filter(e=>ids.has(e.id)),unplacedIds:new Set([...route.unplacedIds].filter(id=>ids.has(id))),context:new Set(),boundary:new Set()};
  }
  function partWorkflow(project,partId) {
    const graph=productionGraph(project,{partId,layers:[]}),positions=productionLayout(graph).positions;
    return graph.steps.slice().sort((a,b)=>positions[a.id].y-positions[b.id].y).map(step=>{
      const parts=project.relations.filter(r=>['applies_to','consumes','produces'].includes(r.type)&&r.from===step.id).map(r=>M.byId(project,r.to)).filter(e=>e&&['Part','Part Revision'].includes(e.type));
      const resources=project.relations.filter(r=>r.type==='requires'&&r.from===step.id).map(r=>M.byId(project,r.to)).filter(Boolean);
      const assignments=project.relations.filter(r=>r.type==='assignment_scope'&&r.to===step.id).map(r=>M.byId(project,r.from)).filter(Boolean);
      const workers=project.relations.filter(r=>r.type==='assigned_to'&&assignments.some(a=>a.id===r.from)).map(r=>M.byId(project,r.to)).filter(Boolean);
      const failures=project.relations.filter(r=>r.type==='on_failure'&&r.from===step.id).map(r=>M.byId(project,r.to)).filter(Boolean);
      const lane=isSubprocess(step)?(['exception','rework'].includes(step.branchKind)?'failure':'detail'):graph.unplacedIds.has(step.id)?'unplaced':'normal';
      return {step,parts,resources,workers,failures,assignments,lane};
    });
  }
  function productionLanes(project,{partIds=null,line='',query='',start='',end=''}={}) {
    const allParts=project.entities.filter(e=>M.isProductPart(e)&&(!line||e.productionFamily===line)).sort((a,b)=>(a.productionFamily||'Unclassified').localeCompare(b.productionFamily||'Unclassified')||(a.productFamily||'').localeCompare(b.productFamily||'')||a.name.localeCompare(b.name));
    const selected=new Set(partIds===null?allParts.map(e=>e.id):partIds);
    const lanes=allParts.filter(part=>selected.has(part.id)).map(part=>{
      const graph=productionGraph(project,{partId:part.id,layers:[],query,start,end,expandedIds:null});
      const positions=productionLayout(graph).positions;
      const items=graph.steps.map(entity=>({
        id:entity.id,entity,parentId:entity.parentWorkId||'',
        lane:isSubprocess(entity)?['exception','rework'].includes(entity.branchKind)?'failure':'detail':graph.unplacedIds.has(entity.id)?'unconfirmed':'normal',
        orderKnown:isSubprocess(entity)||!graph.unplacedIds.has(entity.id),
        order:positions[entity.id]?.y||0
      })).sort((a,b)=>a.order-b.order);
      const ids=new Set(items.map(item=>item.id));
      const edges=graph.relations.filter(r=>['precedes','on_failure','rework_of'].includes(r.type)&&ids.has(r.from)&&ids.has(r.to));
      return {id:part.id,part,items,edges};
    });
    const linked=new Set(allParts.flatMap(part=>productionGraph(project,{partId:part.id,layers:[],expandedIds:null}).steps.map(e=>e.id)));
    const unlinked=!line&&selected.size===allParts.length?project.entities.filter(e=>e.type==='Production Step'&&!linked.has(e.id)):[];
    return {lanes,edges:lanes.flatMap(lane=>lane.edges.map(edge=>({...edge,partId:lane.id}))),stepIds:new Set(lanes.flatMap(lane=>lane.items.map(item=>item.id))),unlinked};
  }
  function productionNetwork(project,options={}) {
    project={...project,relations:project.relations.filter(r=>!r.scopeProjectId||r.scopeProjectId===project.id)};
    const routes=productionLanes(project,options),nodes=new Map(),edges=new Map();
    const partSpecific=options.partIds!=null&&(options.showLineReferences===false||routes.lanes.length<project.entities.filter(e=>M.isProductPart(e)&&(!options.line||e.productionFamily===options.line)).length);
    for(const lane of routes.lanes)for(const item of lane.items){
      if(!nodes.has(item.id))nodes.set(item.id,{id:item.id,entity:item.entity,partIds:[],unconfirmed:item.lane==='unconfirmed'});
      const node=nodes.get(item.id);
      node.partIds.push(lane.id);
      if(item.lane!=='unconfirmed')node.unconfirmed=false;
    }
    for(const entity of routes.unlinked)if(!nodes.has(entity.id))nodes.set(entity.id,{id:entity.id,entity,partIds:[],unconfirmed:true});
    const addEdge=(relation,partId)=>{
      if(!nodes.has(relation.from)||!nodes.has(relation.to))return;
      const key=[relation.type,relation.from,relation.to].join('\0');
      if(!edges.has(key))edges.set(key,{id:relation.id,type:relation.type,from:relation.from,to:relation.to,evidence:relation.evidence||'',partIds:[]});
      if(partId&&!edges.get(key).partIds.includes(partId))edges.get(key).partIds.push(partId);
    };
    for(const lane of routes.lanes){
      for(const edge of lane.edges)addEdge(edge,lane.id);
      for(const item of lane.items)if(item.parentId&&nodes.has(item.parentId)&&!lane.edges.some(edge=>edge.type==='on_failure'&&edge.to===item.id))
        addEdge({id:'structure-'+item.id,type:'subprocess',from:item.parentId,to:item.id},lane.id);
    }
    // A recorded line output/storage flow is useful even before its detailed Part route exists.
    const routeParts=new Set(routes.lanes.map(l=>l.id)),routeMaterials=new Set();
    for(const r of project.relations)if(['consumes','produces'].includes(r.type)&&nodes.has(r.from)&&(!r.routePartId||routeParts.has(r.routePartId))&&(!partSpecific||!M.isProductPart(M.byId(project,r.to))||routeParts.has(r.to)))routeMaterials.add(r.to);
    const lineNames=new Set(routes.lanes.map(l=>l.part.productionFamily).filter(Boolean));
    const routeLines=new Set(project.relations.filter(r=>r.type==='operated_in'&&nodes.has(r.from)).map(r=>r.to));
    const selectedLines=new Set(project.entities.filter(e=>e.type==='Resource'&&e.resourceKind==='line'&&(!options.line||e.name===options.line)&&(!partSpecific||routeLines.has(e.id)||lineNames.has(e.name))).map(e=>e.id));
    if(!partSpecific){let count=-1;while(count!==selectedLines.size){count=selectedLines.size;for(const r of project.relations)if(r.type==='part_of'&&selectedLines.has(r.to)&&M.byId(project,r.from)?.resourceKind==='line')selectedLines.add(r.from);}}
    // Line reference operations with unknown Part correspondence stay out of Part-specific maps.
    if(options.showLineReferences??(options.partIds==null))for(const r of project.relations.filter(r=>r.type==='operated_in'&&selectedLines.has(r.to))){
      const e=M.byId(project,r.from);
      if(e?.type!=='Production Step'||e.status==='archived'||e.branchKind!=='support'||e.processLevel!=='main'||nodes.has(e.id))continue;
      if(project.relations.some(link=>['applies_to','consumes','produces'].includes(link.type)&&link.from===e.id))continue;
      nodes.set(e.id,{id:e.id,entity:e,partIds:[],unconfirmed:true});
    }
    for(const line of project.entities.filter(e=>e.type==='Resource'&&e.resourceKind==='line'&&e.status!=='archived'&&selectedLines.has(e.id)))
      if(project.relations.some(r=>r.type==='produces'&&r.from===line.id&&r.reviewState!=='proposed'&&M.byId(project,r.to)?.itemKind==='component'&&(!partSpecific||routeMaterials.has(r.to))))
        nodes.set(line.id,{id:line.id,entity:line,partIds:[],unconfirmed:false});
    // Source-line rework policies can be shown before a detailed SMT product route exists.
    if(options.line)for(const r of project.relations.filter(r=>r.type==='operated_in'&&selectedLines.has(r.to))){
      const e=M.byId(project,r.from),parent=M.byId(project,e?.parentWorkId);
      if(e?.status==='archived'||e?.branchKind!=='rework'||parent?.productionStage!=='NG storage'||partSpecific&&!nodes.has(parent.id))continue;
      for(const item of [e,parent,...project.entities.filter(n=>n.productionStage==='Scrap'&&n.status!=='archived')])
        nodes.set(item.id,{id:item.id,entity:item,partIds:[],unconfirmed:false});
    }
    for(const r of project.relations)if(['precedes','on_failure','rework_of'].includes(r.type))addEdge(r);
    if(nodes.size){
      const lineOutputs=new Set(project.relations.filter(r=>r.type==='produces'&&nodes.has(r.from)&&r.reviewState!=='proposed'&&(!r.routePartId||routeParts.has(r.routePartId))&&(!partSpecific||routeMaterials.has(r.to))).map(r=>r.to));
      for(const id of lineOutputs){const e=M.byId(project,id);if(e&&M.isComponentPart(e)&&e.status!=='archived')nodes.set(id,{id,entity:e,partIds:[id],unconfirmed:false});}
      for(const r of project.relations)if(r.type==='part_of'&&M.byId(project,r.from)?.resourceKind==='line'&&M.byId(project,r.to)?.resourceKind==='line')addEdge(r);
      const connectedStorage=new Set(project.relations.filter(r=>r.type==='stored_at'&&lineOutputs.has(r.from)||r.type==='receives_from'&&nodes.has(r.to)).map(r=>r.type==='stored_at'?r.to:r.from));
      if(partSpecific)for(const r of project.relations)if(r.type==='stored_at'&&(routeMaterials.has(r.from)||routeParts.has(r.from)))connectedStorage.add(r.to);
      const storage=project.entities.filter(e=>e.type==='Resource'&&e.resourceKind==='facility'&&e.storageRole&&e.status!=='archived'&&(connectedStorage.has(e.id)||!partSpecific&&(routes.lanes.length||routes.unlinked.length)));
      for(const entity of storage)nodes.set(entity.id,{id:entity.id,entity,partIds:routes.lanes.map(l=>l.id),unconfirmed:false});
      for(const r of project.relations)if(r.type==='stored_at'&&storage.some(e=>e.id===r.to)&&(!partSpecific||routeMaterials.has(r.from)||routeParts.has(r.from))){
        const item=M.byId(project,r.from);if(item&&item.status!=='archived')nodes.set(item.id,{id:item.id,entity:item,partIds:routes.lanes.map(l=>l.id),unconfirmed:false});
      }
      for(const r of project.relations){
        if(['transfers_to','stored_at','produces'].includes(r.type))addEdge(r);
        if(r.type==='receives_from'&&storage.some(e=>e.id===r.from)&&(!partSpecific||project.relations.some(link=>['supplies','produces'].includes(link.type)&&link.from===r.to&&routeMaterials.has(link.to)))){
          const source=M.byId(project,r.to);if(!source)continue;
          nodes.set(source.id,{id:source.id,entity:source,partIds:routes.lanes.map(l=>l.id),unconfirmed:false});
          addEdge({...r,from:r.to,to:r.from});
        }
      }
    }
    if(options.showStakeholders){
      for(const id of routeLines)if(M.byId(project,id)?.resourceKind==='line')selectedLines.add(id);
      let count=-1;while(count!==selectedLines.size){count=selectedLines.size;for(const r of project.relations)if(r.type==='part_of'&&selectedLines.has(r.from)&&M.byId(project,r.to)?.resourceKind==='line')selectedLines.add(r.to);}
      for(const scope of project.relations.filter(r=>r.type==='assignment_scope'&&nodes.has(r.to))){
        const assignment=M.byId(project,scope.from);if(!assignment||assignment.status==='archived')continue;
        for(const link of project.relations.filter(r=>r.type==='assigned_to'&&r.from===assignment.id)){
          const person=M.byId(project,link.to);if(!person||person.status==='archived')continue;
          nodes.set(person.id,{id:person.id,entity:person,partIds:[],unconfirmed:false});
          addEdge({id:'staff-'+scope.id+'-'+link.id,from:person.id,to:scope.to,type:'assigned',evidence:[assignment.raci,assignment.role].filter(Boolean).join(' · ')});
        }
      }
      for(const r of project.relations.filter(r=>r.type==='manages'&&nodes.has(r.to)&&M.byId(project,r.to)?.resourceKind==='facility')){
        const manager=M.byId(project,r.from);if(manager&&manager.status!=='archived'){nodes.set(manager.id,{id:manager.id,entity:manager,partIds:[],unconfirmed:false});addEdge(r);}
      }
      const lines=project.entities.filter(e=>e.type==='Resource'&&e.resourceKind==='line'&&selectedLines.has(e.id));
      for(const line of lines){
        const teams=project.relations.filter(r=>r.type==='supports_line'&&r.to===line.id&&M.byId(project,r.from)?.type==='Organization');
        for(const r of teams){const team=M.byId(project,r.from);if(team.status==='archived')continue;nodes.set(line.id,{id:line.id,entity:line,partIds:[],unconfirmed:false});nodes.set(team.id,{id:team.id,entity:team,partIds:[],unconfirmed:false});addEdge(r);for(const member of project.relations.filter(x=>x.type==='member_of'&&x.to===team.id)){const person=M.byId(project,member.from);if(person?.type==='Person'&&person.status!=='archived'){nodes.set(person.id,{id:person.id,entity:person,partIds:[],unconfirmed:false});addEdge(member);}}}
        const links=project.relations.filter(r=>['manages','works_on'].includes(r.type)&&r.to===line.id&&M.byId(project,r.from)?.type==='Person');
        if(!links.length)continue;
        nodes.set(line.id,{id:line.id,entity:line,partIds:[],unconfirmed:false});
        for(const r of links){const e=M.byId(project,r.from);if(e.status==='archived')continue;nodes.set(e.id,{id:e.id,entity:e,partIds:[],unconfirmed:false});addEdge(r);}
      }
      for(let pass=0;pass<5;pass++)for(const r of project.relations){
        if(!['operated_in','member_of','reports_via','escalates_to','reports_to'].includes(r.type)||!nodes.has(r.from))continue;
        const e=M.byId(project,r.to);if(!e||e.status==='archived')continue;
        nodes.set(e.id,{id:e.id,entity:e,partIds:[],unconfirmed:false});addEdge(r);
      }
      // Contact context shares route highlights, while productionContextLayout keeps it beside the process.
      const sources=[...nodes.values()].filter(n=>n.entity.type==='Production Step'||selectedLines.has(n.id));
      for(const id of selectedLines)if(!nodes.has(id))sources.push({id,entity:M.byId(project,id),partIds:[]});
      for(const source of sources){
        const contact=reportingContacts(project,source.id);
        for(const r of contact.relations){
          for(const id of [r.from,r.to]){
            if(!nodes.has(id)&&M.byId(project,id)?.type==='Production Step')continue;
            if(!nodes.has(id))nodes.set(id,{id,entity:M.byId(project,id),partIds:[],unconfirmed:false});
            const node=nodes.get(id);
            if(node.entity.type!=='Production Step')for(const partId of source.partIds)if(!node.partIds.includes(partId))node.partIds.push(partId);
          }
          addEdge(r);for(const partId of source.partIds)addEdge(r,partId);
        }
      }
    }
    return {nodes:[...nodes.values()],edges:[...edges.values()],parts:routes.lanes.map(lane=>lane.part),unlinked:routes.unlinked,partOnly:partSpecific};
  }
  function networkLayout(nodes,edges,options={}) {
    const dispositions=nodes.filter(node=>['NG storage','Scrap'].includes(node.entity.productionStage));
    if(dispositions.length){
      const shared=new Set(dispositions.map(node=>node.id));
      const returns=nodes.filter(node=>node.entity.branchKind==='rework'&&shared.has(node.entity.parentWorkId));
      for(const node of returns)shared.add(node.id);
      const base=networkLayout(nodes.filter(node=>!shared.has(node.id)),edges.filter(edge=>!shared.has(edge.from)&&!shared.has(edge.to)),options);
      const anchors=edges.filter(edge=>edge.type==='on_failure'&&shared.has(edge.to)&&!shared.has(edge.from)).map(edge=>base.positions[edge.from]).filter(Boolean);
      const x=returns.length?base.width+40:anchors.length?Math.max(...anchors.map(p=>p.x))+240:base.width-210;
      const y=anchors.length?anchors.reduce((sum,p)=>sum+p.y,0)/anchors.length:36;
      dispositions.sort((a,b)=>a.entity.productionStage==='NG storage'?-1:1).forEach((node,index)=>{base.positions[node.id]={x,y:y+index*130};});
      const ordered=returns.slice().sort((a,b)=>a.id.localeCompare(b.id));
      // Repair before reinspection, independently for each producing source.
      for(const edge of edges.filter(e=>e.type==='precedes'&&shared.has(e.from)&&shared.has(e.to))){
        const a=ordered.findIndex(n=>n.id===edge.from),b=ordered.findIndex(n=>n.id===edge.to);
        if(a>=0&&b>=0&&a>b)[ordered[a],ordered[b]]=[ordered[b],ordered[a]];
      }
      ordered.forEach((node,index)=>{base.positions[node.id]={x:x+260,y:y+index*130};});
      base.width=Math.max(base.width,x+(returns.length?490:230));base.height=Math.max(base.height,y+Math.max(dispositions.length,returns.length)*130+40);return base;
    }
    const nodeById=new Map(nodes.map(node=>[node.id,node])),neighbors=new Map(nodes.map(node=>[node.id,new Set()]));
    for(const edge of edges)if(neighbors.has(edge.from)&&neighbors.has(edge.to)){neighbors.get(edge.from).add(edge.to);neighbors.get(edge.to).add(edge.from);}
    const seen=new Set(),components=[];
    for(const node of nodes)if(!seen.has(node.id)){
      const queue=[node.id],ids=[];seen.add(node.id);
      for(let i=0;i<queue.length;i++){const id=queue[i];ids.push(id);for(const next of neighbors.get(id))if(!seen.has(next)){seen.add(next);queue.push(next);}}
      components.push(ids);
    }
    const context=options.context||{},withContext=Object.values(context).some(group=>group.inputs?.length||group.outputs?.length||group.machines?.length),partOrder=options.partOrder||[];
    const routeIndex=ids=>Math.min(...ids.flatMap(id=>(nodeById.get(id).partIds||[]).map(partId=>partOrder.indexOf(partId)).filter(index=>index>=0)),Infinity);
    components.sort((a,b)=>withContext?routeIndex(a)-routeIndex(b)||b.length-a.length||nodeById.get(a[0]).entity.name.localeCompare(nodeById.get(b[0]).entity.name):b.length-a.length||nodeById.get(a[0]).entity.name.localeCompare(nodeById.get(b[0]).entity.name));
    const positions={},nodeWidth=194,xGap=withContext?500:42,yGap=106,maxPerRank=withContext?6:4,canvasWidth=withContext?5000:1340,leftInset=withContext?238:28;
    let shelfX=leftInset,shelfY=36,shelfHeight=0,right=0;
    for(const ids of components){
      const entryLines=id=>edges.filter(e=>e.type==='escalates_to'&&e.to===id&&nodeById.get(e.from)?.entity.resourceKind==='line').map(e=>e.from);
      const equivalentEntry=edge=>edge.type==='escalates_to'&&entryLines(edge.from).some(id=>entryLines(edge.to).includes(id));
      const inComponent=new Set(ids),forward=edges.filter(edge=>inComponent.has(edge.from)&&inComponent.has(edge.to)&&!equivalentEntry(edge)&&['member_of','reports_via','escalates_to','reports_to','precedes','stored_at','produces','transfers_to','receives_from','subprocess','on_failure','blocks','required_for','apqp_input_to'].includes(edge.type));
      const incoming=new Map(ids.map(id=>[id,0])),rank=new Map(ids.map(id=>[id,0]));
      forward.forEach(edge=>incoming.set(edge.to,incoming.get(edge.to)+1));
      const queue=ids.filter(id=>incoming.get(id)===0);
      for(let i=0;i<queue.length;i++)for(const edge of forward)if(edge.from===queue[i]){
        rank.set(edge.to,Math.max(rank.get(edge.to),rank.get(edge.from)+1));
        incoming.set(edge.to,incoming.get(edge.to)-1);
        if(incoming.get(edge.to)===0)queue.push(edge.to);
      }
      const rows=new Map();for(const id of ids){const level=rank.get(id);if(!rows.has(level))rows.set(level,[]);rows.get(level).push(id);}
      const sorted=[...rows].sort((a,b)=>a[0]-b[0]);
      let localY=0;
      for(const [,items] of sorted){
        items.sort((a,b)=>{
          const priority=id=>Math.min(...forward.filter(edge=>edge.to===id).map(edge=>edge.type==='precedes'?0:edge.type==='on_failure'?3:edge.type==='subprocess'?2:1),1);
          const parentA=forward.find(edge=>edge.to===a),parentB=forward.find(edge=>edge.to===b);
          const parentOrder=parentA&&parentB?ids.indexOf(parentA.from)-ids.indexOf(parentB.from):0;
          return parentOrder||priority(a)-priority(b)||nodeById.get(a).entity.name.localeCompare(nodeById.get(b).entity.name)||a.localeCompare(b);
        });
        const occupied=new Set();
        items.forEach((id,index)=>{const parent=forward.find(e=>e.to===id&&e.type==='precedes'&&positions[e.from]);let x=parent?positions[parent.from].x:(index%maxPerRank)*(nodeWidth+xGap);while(occupied.has(x))x+=nodeWidth+xGap;occupied.add(x);positions[id]={x,y:localY+Math.floor(index/maxPerRank)*yGap};});
        const satelliteHeight=withContext?Math.max(...items.map(id=>Math.max(context[id]?.inputs?.length+context[id]?.machines?.length||0,context[id]?.outputs?.length||0)*59+20),yGap):yGap;
        localY+=Math.ceil(items.length/maxPerRank)*satelliteHeight;
      }
      for(const edge of forward.filter(edge=>edge.type==='on_failure'))if(positions[edge.from]&&positions[edge.to])
        positions[edge.to].x=Math.max(positions[edge.to].x,positions[edge.from].x+nodeWidth+xGap);
      const width=Math.max(...ids.map(id=>positions[id].x+nodeWidth+(withContext&&context[id]?.outputs?.length?216:0)))+(withContext?218:0);
      if(shelfX>leftInset&&shelfX+width>canvasWidth){shelfX=leftInset;shelfY+=shelfHeight+86;shelfHeight=0;}
      for(const id of ids){positions[id].x+=shelfX;positions[id].y+=shelfY;}
      shelfX+=width+90;shelfHeight=Math.max(shelfHeight,localY);right=Math.max(right,shelfX);
    }
    return {positions,width:Math.max(480,right+24),height:Math.max(360,shelfY+shelfHeight+46)};
  }
  function productionContextLayout(project,projection,{showMachines=true,showComponents=true}={}) {
    const selected=new Set(projection.parts.map(part=>part.id)),context={};
    let previous=-1;while(previous!==selected.size){previous=selected.size;for(const r of project.relations)if(r.type==='part_of'&&selected.has(r.to)&&M.isProductPart(M.byId(project,r.from)))selected.add(r.from);}
    for(const node of projection.nodes) {
      if(node.entity.type!=='Production Step')continue;
      const related=project.relations.filter(relation=>relation.from===node.id && (!relation.routePartId||selected.has(relation.routePartId)));
      const materials=type=>related.filter(relation=>relation.type===type).map(relation=>({entity:M.byId(project,relation.to),relation})).filter(item=>['Part','Part Revision'].includes(item.entity?.type)&&(!projection.partOnly||M.isComponentPart(item.entity)||selected.has(item.entity.id)));
      const machines=related.filter(relation=>relation.type==='requires').map(relation=>({entity:M.byId(project,relation.to),relation})).filter(item=>['machine','test_equipment'].includes(item.entity?.resourceKind));
      context[node.id]={inputs:showComponents?materials('consumes'):[],outputs:showComponents?materials('produces'):[],machines:showMachines?machines:[]};
    }
    const support=projection.nodes.filter(n=>['Person','Organization','Resource','Part','Part Revision'].includes(n.entity.type)),supportIds=new Set(support.map(n=>n.id));
    const process=projection.nodes.filter(n=>!supportIds.has(n.id));
    const base=networkLayout(process,projection.edges.filter(e=>!supportIds.has(e.from)&&!supportIds.has(e.to)),{context,partOrder:projection.parts.map(part=>part.id)}),satellites=[];
    if(support.length){
      const side=networkLayout(support,projection.edges.filter(e=>supportIds.has(e.from)&&supportIds.has(e.to)));
      const offset=process.length?base.width+80:0;
      for(const [id,pos] of Object.entries(side.positions))base.positions[id]={x:pos.x+offset,y:pos.y};
      base.width=Math.max(base.width,offset+side.width);base.height=Math.max(base.height,side.height);
    }
    for(const node of projection.nodes){
      const pos=base.positions[node.id],group=context[node.id];if(!pos||!group)continue;
      for(const [direction,items] of [['input',[...group.machines.map(item=>({...item,kind:'machine'})),...group.inputs.map(item=>({...item,kind:'part'}))]],['output',group.outputs.map(item=>({...item,kind:'part'}))]])
        items.forEach((item,index)=>satellites.push({...item,stepId:node.id,partIds:node.partIds||[],direction,x:pos.x+(direction==='input'?-218:212),y:pos.y+index*59}));
    }
    return {...base,satellites};
  }
  function workstreamLanes(project,options={}) {
    const graph=projectGraph(project,options);
    const processTypes=new Set([...SCHEDULE_TYPES,'Decision']);
    const storageRelations=graph.relations.filter(r=>['receives_from','stored_at','transfers_to','manages'].includes(r.type));
    const storageIds=new Set(storageRelations.flatMap(r=>[r.from,r.to]));
    for(const r of graph.relations)if(r.type==='produces'&&storageIds.has(r.to))storageIds.add(r.from);
    const entities=graph.entities.filter(e=>(processTypes.has(e.type)||storageIds.has(e.id))&&!e.productionEventKind&&!e.qualityKind&&e.status!=='archived');
    const codes=new Set(M.WORKSTREAMS.map(item=>item.code));
    const lanes=[...M.WORKSTREAMS.map(item=>({code:item.code,label:item.label,items:[]})),{code:'unassigned',label:'Unassigned',items:[]}];
    for(const entity of entities){
      const memberships=(project.workstreams?.[entity.id]||[]).filter(code=>codes.has(code));
      const lane=lanes.find(item=>item.code===(memberships[0]||'unassigned'));
      lane.items.push({id:entity.id,entity,secondary:memberships.slice(1)});
    }
    const ids=new Set(entities.map(e=>e.id));
    const edges=graph.relations.filter(r=>ids.has(r.from)&&ids.has(r.to)&&['receives_from','stored_at','transfers_to','manages','produces','precedes','blocks','required_for','condition_target','apqp_input_to','on_failure','rework_of','potentially_affects','subprocess'].includes(r.type)).map(r=>r.type==='receives_from'?{...r,from:r.to,to:r.from}:r);
    return {lanes,edges,entities,context:graph.context};
  }
  function productionLaneLayout(projection) {
    const nodes=[],edges=[],bands=[];
    let y=22,maxWidth=720;
    const lanes=[...projection.lanes];
    if(projection.unlinked.length)lanes.push({id:'unlinked',part:{name:'Unlinked steps'},items:projection.unlinked.map(entity=>({id:entity.id,entity,parentId:entity.parentWorkId||'',lane:'unconfirmed',orderKnown:false,order:0})),edges:[]});
    for(const lane of lanes){
      const byId=new Map(lane.items.map(item=>[item.id,item]));
      const rootOf=item=>{
        let current=item,seen=new Set([item.id]);
        while(current.parentId&&byId.has(current.parentId)&&!seen.has(current.parentId)){
          current=byId.get(current.parentId);seen.add(current.id);
        }
        return current.id;
      };
      const roots=lane.items.filter(item=>rootOf(item)===item.id);
      const ordered=[...roots.filter(item=>item.lane==='normal').sort((a,b)=>a.order-b.order),...roots.filter(item=>item.lane!=='normal').sort((a,b)=>a.order-b.order)];
      let deepest=0,cursor=226,unconfirmedX=null;
      ordered.forEach(root=>{
        const x=cursor,children=lane.items.filter(item=>item.id!==root.id&&rootOf(item)===root.id);
        const detail=children.filter(item=>item.lane!=='failure').sort((a,b)=>a.order-b.order);
        const failures=children.filter(item=>item.lane==='failure').sort((a,b)=>a.order-b.order);
        if(!root.orderKnown&&unconfirmedX===null)unconfirmedX=x;
        nodes.push({...root,key:lane.id+':'+root.id,partId:lane.id,x,y:y+44});
        detail.forEach((item,i)=>nodes.push({...item,key:lane.id+':'+item.id,partId:lane.id,x:x+12,y:y+158+i*106}));
        failures.forEach((item,i)=>nodes.push({...item,key:lane.id+':'+item.id,partId:lane.id,x:x+270,y:y+158+i*106}));
        deepest=Math.max(deepest,detail.length,failures.length);
        cursor+=failures.length?526:256;
      });
      const height=Math.max(172,176+deepest*106);
      bands.push({id:lane.id,label:lane.part.name,y,height,part:lane.part,empty:!lane.items.length,unconfirmedX});
      for(const edge of lane.edges)edges.push({...edge,key:lane.id+':'+edge.id,partId:lane.id,fromKey:lane.id+':'+edge.from,toKey:lane.id+':'+edge.to});
      maxWidth=Math.max(maxWidth,cursor+32);
      y+=height+12;
    }
    return {nodes,edges,bands,width:maxWidth,height:Math.max(340,y+20)};
  }
  function workstreamLaneLayout(projection) {
    const nodes=[],bands=[],positions=new Map(),columns=6,stepX=246,stepY=110;
    let y=22;
    for(const lane of projection.lanes){
      const byId=new Map(lane.items.map(item=>[item.id,item]));
      const sequence=projection.edges.filter(edge=>edge.type==='precedes'&&byId.has(edge.from)&&byId.has(edge.to));
      const incoming=new Map(lane.items.map(item=>[item.id,0]));
      for(const edge of sequence)incoming.set(edge.to,incoming.get(edge.to)+1);
      const byName=(a,b)=>a.entity.name.localeCompare(b.entity.name);
      const queue=lane.items.filter(item=>incoming.get(item.id)===0).sort(byName),items=[];
      while(queue.length){
        const item=queue.shift();items.push(item);
        for(const edge of sequence.filter(edge=>edge.from===item.id)){
          incoming.set(edge.to,incoming.get(edge.to)-1);
          if(!incoming.get(edge.to)){queue.push(byId.get(edge.to));queue.sort(byName);}
        }
      }
      items.push(...lane.items.filter(item=>!items.includes(item)).sort(byName));
      const height=items.length?46+Math.ceil(items.length/columns)*stepY:54;
      bands.push({id:lane.code,label:lane.label,y,height,empty:!items.length});
      items.forEach((item,index)=>{const node={...item,key:item.id,laneId:lane.code,x:214+(index%columns)*stepX,y:y+42+Math.floor(index/columns)*stepY};nodes.push(node);positions.set(item.id,node);});
      y+=height+12;
    }
    return {nodes,edges:projection.edges.filter(edge=>positions.has(edge.from)&&positions.has(edge.to)),bands,width:214+columns*stepX+30,height:y+20};
  }
  function productionLayout(graph,{compact=false}={}) {
    const steps=graph.steps, byId=new Map(graph.entities.map(e=>[e.id,e]));
    const compare=(a,b)=>(a.operationCode||a.name).localeCompare(b.operationCode||b.name);
    const sequence=group=>{
      const ids=new Set(group.map(e=>e.id)),incoming=new Map(group.map(e=>[e.id,0])),ordered=[];
      const edges=graph.relations.filter(r=>r.type==='precedes'&&ids.has(r.from)&&ids.has(r.to));
      edges.forEach(r=>incoming.set(r.to,incoming.get(r.to)+1));
      const queue=group.filter(e=>incoming.get(e.id)===0).sort(compare);
      while(queue.length){
        const step=queue.shift();ordered.push(step);
        for(const r of edges.filter(edge=>edge.from===step.id)){
          incoming.set(r.to,incoming.get(r.to)-1);
          if(!incoming.get(r.to)){queue.push(byId.get(r.to));queue.sort(compare);}
        }
      }
      return [...ordered,...group.filter(e=>!ordered.includes(e)).sort(compare)];
    };
    const ordered=[],seen=new Set();
    function append(step){
      if(seen.has(step.id))return;
      seen.add(step.id);ordered.push(step);
      const children=steps.filter(e=>e.parentWorkId===step.id),failure=e=>['exception','rework'].includes(e.branchKind);
      [...sequence(children.filter(e=>!failure(e))),...sequence(children.filter(failure))].forEach(append);
    }
    sequence(steps.filter(e=>!isSubprocess(e))).forEach(append);
    sequence(steps).forEach(append);
    const positions={};let maxY=0,maxX=0,normalIndex=0;
    const failures=ordered.filter(e=>isSubprocess(e)&&['exception','rework'].includes(e.branchKind));
    for(const e of ordered.filter(e=>!failures.includes(e))){
      const x=isSubprocess(e)?510:340,y=48+normalIndex++*148;
      positions[e.id]={x,y};maxY=Math.max(maxY,y);maxX=Math.max(maxX,x);
    }
    const anchorY=e=>{
      const source=graph.relations.find(r=>r.type==='on_failure'&&r.to===e.id&&positions[r.from]);
      return positions[source?.from||e.parentWorkId]?.y??48;
    };
    let lastFailureY=-100;
    for(const e of failures.sort((a,b)=>anchorY(a)-anchorY(b))){
      const y=Math.max(anchorY(e),lastFailureY+148);lastFailureY=y;
      positions[e.id]={x:850,y};maxY=Math.max(maxY,y);maxX=Math.max(maxX,850);
    }
    const last={parts:-100,people:-100,resources:-100,gates:-100};
    for(const e of graph.entities.filter(e=>e.type!=='Production Step')){
      const group=['Part','Part Revision'].includes(e.type)?'parts':['Person','Organization'].includes(e.type)?'people':e.type==='Resource'?'resources':'gates';
      const x={parts:16,people:1100,resources:compact?1100:1360,gates:compact?1100:1360}[group];
      const anchor=graph.relations.find(r=>r.from===e.id&&positions[r.to]||r.to===e.id&&positions[r.from]);
      const anchorY=anchor?(positions[anchor.from]||positions[anchor.to]).y:48;
      const offset=group==='resources'?128:group==='gates'?256:0;
      const y=Math.max(anchorY+offset,last[group]+136);last[group]=y;positions[e.id]={x,y};maxY=Math.max(maxY,y);maxX=Math.max(maxX,x);
    }
    return {positions,width:Math.max(560,maxX+250),height:Math.max(330,maxY+140)};
  }
  function layout(entities, relations) {
    const subs = entities.filter(isSubprocess);
    if (subs.length) {
      const main = entities.filter(e=>!isSubprocess(e)), base = layout(main,relations);
      const remaining = [...subs]; let lastY = -100;
      while (remaining.length) {
        let index = remaining.findIndex(e=>!remaining.some(other=>other.id===e.parentWorkId));
        if (index < 0) index = 0;
        const e=remaining.splice(index,1)[0], parent=base.positions[e.parentWorkId];
        const y=Math.max(parent?.y||48,lastY+124); lastY=y;
        base.positions[e.id]={x:base.width+32,y};
      }
      return {positions:base.positions,width:base.width+284,height:Math.max(base.height,lastY+140)};
    }
    const ids = new Set(entities.map(e=>e.id));
    const edges = relations.filter(r=>["precedes","produces","condition_target"].includes(r.type) && ids.has(r.from) && ids.has(r.to)).map(r=>r.type === "condition_target" ? [r.to,r.from] : [r.from,r.to]);
    const ranks = new Map(entities.map(e=>[e.id,0])), incoming = new Map(entities.map(e=>[e.id,0]));
    edges.forEach(([,b])=>incoming.set(b,incoming.get(b)+1));
    const queue = entities.filter(e=>incoming.get(e.id)===0).map(e=>e.id);
    for (let i=0;i<queue.length;i++) for (const [a,b] of edges) if (a===queue[i]) {
      ranks.set(b,Math.max(ranks.get(b),ranks.get(a)+1)); incoming.set(b,incoming.get(b)-1);
      if (!incoming.get(b)) queue.push(b);
    }
    const rows = new Map(), positions = {};
    // ponytail: deterministic lanes, not crossing minimization. Use a graph layout library if large mixed graphs need it.
    for (const e of entities) {
      const row = ranks.get(e.id); if (!rows.has(row)) rows.set(row,[]); rows.get(row).push(e);
    }
    const maxColumns = Math.min(4,Math.max(1,...[...rows.values()].map(row=>row.length)));
    const width = Math.max(320, maxColumns * 256 + 64);
    let y=48;
    for (const [,row] of [...rows].sort((a,b)=>a[0]-b[0])) {
      row.forEach((e,i)=> { positions[e.id] = {x:(width-Math.min(4,row.length)*256)/2+(i%4)*256+16,y:y+Math.floor(i/4)*156}; });
      y+=Math.ceil(row.length/4)*156;
    }
    return {positions,width,height:Math.max(400,y)};
  }
  function parseCSV(text,delimiter=',') {
    if (text.length > 2_000_000) throw Error("CSV exceeds 2 MB. Split into smaller batches.");
    text = text.replace(/^\uFEFF/, "");
    const rows = []; let row = [], field = "", quoted = false, closed = false;
    function cell() { row.push(field); field = ""; closed = false; }
    function line() { cell(); if (row.some(v => v.trim())) rows.push(row); row = []; }
    for (let i=0;i<text.length;i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i+1] === '"') {field += '"'; i++;}
        else if (char === '"') {quoted = false; closed = true;}
        else field += char;
      } else if (char === '"') {
        if (field || closed) throw Error("Unexpected quote in CSV.");
        quoted = true;
      } else if (char === delimiter) cell();
      else if (char === '\n' || char === '\r') { if (char === '\r' && text[i+1] === '\n') i++; line(); }
      else { if (closed) throw Error("Unexpected text after closing quote."); field += char; }
    }
    if (quoted) throw Error("Unclosed quoted CSV field.");
    if (field || row.length || closed) line();
    if (rows.length < 2) throw Error("Include a header and at least one data row.");
    if (rows.length > 1001) throw Error("Maximum 1,000 rows per batch.");
    const headers = rows.shift().map(v=>v.trim());
    if (headers.some(h=>!h) || new Set(headers).size !== headers.length) throw Error("Empty or duplicate column header.");
    return {headers, rows:rows.map((values,i)=> {
      if (values.length !== headers.length) throw Error(`Row ${i+2}: expected ${headers.length} columns, found ${values.length}.`);
      return Object.fromEntries(headers.map((h,j)=>[h,values[j].trim()]));
    })};
  }
  function previewCSV(project, text, kind, {library=null,choices={}}={}) {
    const result = {rows:[],errors:[],project:null};
    try {
      if (project.status === "archived") throw Error("Archived project is read only.");
      if (!["objects","relations"].includes(kind)) throw Error("Choose objects or relations.");
      const parsed = parseCSV(text), allowed = kind === "objects" ? OBJECT_COLUMNS : RELATION_COLUMNS;
      const required = kind === "objects" ? ["id","type","name"] : ["id","type","from","to"];
      for (const column of parsed.headers) if (!allowed.includes(column)) throw Error(`Unknown column: ${column}. Use the template headers.`);
      for (const column of required) if (!parsed.headers.includes(column)) throw Error(`Missing column: ${column}.`);
      if(kind === "relations") return Resolver.previewRelations(project,parsed.rows,library);
      const next = JSON.parse(JSON.stringify(project));
      const seen = new Set(next.entities.map(e=>e.id)), batchIds=new Set();
      const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
      parsed.rows.forEach((row,i)=> {
        try {
          if (!/^[A-Za-z0-9_-]+$/.test(row.id)) throw Error("ID must contain letters, numbers, underscores or hyphens.");
          if (seen.has(row.id)) throw Error(`Duplicate ID ${row.id}. Existing records are never overwritten.`);
          if (batchIds.has(row.id)) throw Error(`Duplicate ID ${row.id} in this batch.`);
          batchIds.add(row.id);
          const global=library?.entities||[];
          const candidates=new Map([...global,...next.entities].map(e=>[e.id,e]));
          const matches=[...candidates.values()].filter(e=>e.id===row.id || (e.type===row.type && normalized(e.name)===normalized(row.name)));
          const matchList=matches.map(e=>({id:e.id,name:e.name,type:e.type}));
          const choice=choices[row.id];
          if(matches.length && !choice){
            result.rows.push({...row,status:'needs_review',matches:matchList,note:'Choose reuse, create separate, or skip. Nothing has been saved.'});
            result.errors.push(`Row ${i+2}: possible Library match; choose how to handle it.`);
            return;
          }
          if(choice?.action==='skip') {result.rows.push({...row,status:'skipped',matches:matchList});return;}
          if(choice?.action==='reuse') {
            const target=matches.find(e=>e.id===choice.targetId && e.type===row.type);
            if(!target)throw Error('Selected Library object does not match this row.');
            if(M.PROJECT_OWNED_TYPES.has(target.type) && project.id!=='library' && !project.entities.some(e=>e.id===target.id))throw Error('Project-owned work cannot be reused in another project. Use a new ID.');
            if(project.id!=='library' && !next.entities.some(e=>e.id===target.id))next.entities.push({...target,projectId:project.id});
            result.rows.push({...row,id:target.id,csvId:row.id,status:'reused',matches:matchList,note:row.id===target.id?'Linked existing object':'Linked '+target.id+'; use this ID in relationship CSV.'});
            return;
          }
          if(choice && choice.action!=='create')throw Error('Choose reuse, create separate, or skip.');
          if(global.some(e=>e.id===row.id))throw Error(`ID ${row.id} is already used in Library. Reuse it or change the CSV ID.`);
          if(project.id==='library'&&row.type==='Production Step'&&M.DATE_FIELDS.some(field=>field!=='assessedOn'&&row[field]))throw Error('Production Step dates belong to a project. Import this row inside its project or clear dates.');
          const entity=M.addEntity(next,row);
          entity.id=row.id;
          seen.add(row.id);
          result.rows.push({...row,status:'ready',matches:matchList,note:choice?.action==='create'?'Separate object confirmed':''});
        } catch (error) { result.errors.push(`Row ${i+2}: ${error.message}`); }
      });
      if (!result.errors.length) { M.validateStore(next); result.project = next; }
    } catch(error) { result.errors.push(error.message); }
    return result;
  }
  function importedIds(rows) {
    const ids=rows.filter(row=>!row.status||['ready','normalized','reused'].includes(row.status)).map(row=>row.resolved?.id ?? row.id);
    if(ids.some(id=>typeof id!=='string'||!id))throw Error('Import preview is missing a record ID.');
    return ids;
  }
  const api = {OBJECT_COLUMNS,RELATION_COLUMNS,SCHEDULE_TYPES,isSubprocess,range,overlaps,ganttWindow,downstream,localGraph,neighborhood,projectGraph,workstreamGraph,productionGraph,productionLanes,productionNetwork,networkLayout,productionContextLayout,productionLaneLayout,workstreamLanes,workstreamLaneLayout,partSummary,partFocusedGraph,workstreamSummary,productionLayout,partWorkflow,layout,parseCSV,previewCSV,importedIds};
  api.belongsToPart=(item,partId)=>!partId||(item.partIds||[]).includes(partId)&&(!item.relation?.routePartId||item.relation.routePartId===partId);
  api.workstreamRecords=workstreamRecords;
  api.relatedRisks=relatedRisks;
  api.reportingContacts=reportingContacts;
  api.selectionNeighborhood=(project,ids)=>new Set([...ids].flatMap(id=>[...neighborhood(project,id)]));
  if (typeof module === "object") module.exports = api; else root.PMWorkflow = api;
})(globalThis);
