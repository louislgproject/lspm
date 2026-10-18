(function(root){
  const G=typeof module==='object'?require('./progress'):root.ProductionProgress,H=typeof module==='object'?require('./history'):root.EventHistory;
  function upload(project,input,time,id){
    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>200000)throw Error('Paste 1–200,000 characters.');
    if(project.status==='archived')throw Error('Open an active project.');G.validate(project,input.rows);
    const eventId='cloud-event-'+id,rows=input.rows.map(r=>({partId:r.partId,stepId:r.stepId,code:project.entities.find(e=>e.id===r.partId)?.modelCode||'',row:Number.isSafeInteger(r.row)?r.row:1,column:Number.isSafeInteger(r.column)?r.column:1,quantity:r.quantity,unit:G.unitKey(r.unit),capturedAt:time,createdAt:time,snapshotId:'cloud-wip-'+id+'-'+G.unitKey(r.unit),eventId})),subjects=[...new Set(rows.flatMap(r=>[r.partId,r.stepId]))];
    const record={schemaVersion:1,recordClass:'production_log',kind:'observation',statementMode:'observed_fact',verification:'reported',lifecycle:'active',timePrecision:'exact',importance:'normal',occurredAt:time,reportedAt:time,recordedAt:time,timezone:'America/Mexico_City',scope:{kind:'explicit_projects',projectIds:[project.id]},facets:['production'],observations:[],unresolved:[]};H.validateEvent(record);
    return {projectId:project.id,text:input.text,rows,event:{id:eventId,type:'Event',name:'WIP 관측 · '+new Set(rows.map(r=>r.partId)).size+' Part',status:'active',context:'업로드 시각의 WIP 관측값. 생산량·현재 공정 구조 변경 아님.',privacy:'local_only',eventRecord:record},links:subjects.map(to=>({id:eventId+'-'+to,from:eventId,to,type:'records_on',historyRole:'subject'}))};
  }
  function historyVisible(w,event,scope,ids,members){
    if(scope!=='library'&&w.viewSettings?.[scope]?.overview?.historyScope==='explicit_projects'&&event.eventRecord.scope.kind!=='explicit_projects')return false;
    return H.visible(event,scope,ids,members);
  }
  function detail(w,id,scope='library'){
    const event=w.library.entities.find(e=>e.id===id),p=scope==='library'?w.library:w.projects.find(p=>p.id===scope),links=w.library.relations.filter(r=>r.from===id||r.to===id);
    if(!event?.eventRecord||!p||!historyVisible(w,event,scope,links.filter(r=>r.from===id&&r.type==='records_on'&&r.historyRole!=='context').map(r=>r.to),new Set(p.entities.map(e=>e.id))))throw Error('Event outside this scope.');
    return {event,links};
  }
  function query(w,q={}){
    const scope=q.scope||'library',p=scope==='library'?w.library:w.projects.find(x=>x.id===scope);if(!p)throw Error('Unknown project.');if(q.start&&q.end&&q.start>q.end)throw Error('History start must precede end.');
    const byId=new Map(w.library.entities.map(e=>[e.id,e])),projectIds=new Set(p.entities.map(e=>e.id)),requested=new Set(q.subjectIds||[]),visible=new Set(q.visibleSubjectIds||[]),byFrom=new Map(),items=[],personIdentities=new Map();
    for(const r of w.library.relations){if(!byFrom.has(r.from))byFrom.set(r.from,[]);byFrom.get(r.from).push(r);}
    for(const e of w.library.entities){const r=e.eventRecord;if(e.type!=='Event'||!H.business(r,q.focus))continue;const links=byFrom.get(e.id)||[],ids=links.filter(x=>x.type==='records_on'&&x.historyRole!=='context').map(x=>x.to);if(!historyVisible(w,e,scope,ids,projectIds))continue;const t=H.time(r,q.dateBasis,q.timezone||'America/Mexico_City');if(q.start&&t.day<q.start||q.end&&t.day>q.end)continue;if(q.kinds?.length&&!q.kinds.includes(r.kind)||q.verification&&q.verification!==r.verification)continue;const participants=links.filter(x=>['reported_by','performed_by','requested_from'].includes(x.type)).map(x=>{
      if(!personIdentities.has(x.to))personIdentities.set(x.to,H.personIdentity(w.library,x.to));
      return {...personIdentities.get(x.to),role:x.type};
    });if(q.personId&&!participants.some(x=>x.id===q.personId||x.canonicalId===q.personId)||requested.size&&!ids.some(id=>requested.has(id)))continue;if(q.workstream&&!r.facets?.includes(q.workstream)&&!ids.some(id=>p.workstreams?.[id]?.includes(q.workstream)))continue;if(q.lineId&&r.lineId!==q.lineId&&!ids.some(id=>id===q.lineId||(byFrom.get(id)||[]).some(x=>x.type==='operated_in'&&x.to===q.lineId)))continue;items.push({id:e.id,title:e.name,summary:e.context,record:r,time:t,subjectIds:ids,subjects:ids.map(id=>({id,name:byId.get(id)?.name||id,type:byId.get(id)?.type})),participants,hiddenSubjects:visible.size?ids.filter(id=>!visible.has(id)):[]});}
    items.sort((a,b)=>(Date.parse(b.time.value)||0)-(Date.parse(a.time.value)||0)||a.id.localeCompare(b.id));const counts={};for(const e of items)for(const id of new Set(e.subjectIds))(counts[id]||=[]).push(e.id);const offset=Math.max(0,Number(q.cursor)||0),limit=Math.min(100,Math.max(1,Number(q.limit)||50));return {items:items.slice(offset,offset+limit),nextCursor:offset+limit<items.length?String(offset+limit):null,totalDistinct:items.length,unmatchedCount:items.filter(e=>!e.subjectIds.length).length,counts,priorities:H.priorities(items)};
  }
  const api={upload,query,detail};if(typeof module==='object')module.exports=api;else root.CloudDomain=api;
})(globalThis);
