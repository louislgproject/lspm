(function(root){
 const M=typeof module==='object'?require('./ontology-model'):root.OntologyModel,G=typeof module==='object'?require('./progress'):root.ProductionProgress,F=typeof module==='object'?require('./final-parts'):root.FinalParts;
 const day=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
 const productionDay=v=>day(new Date(Date.parse(v)-7*3600000));
 const daySlots=date=>Array.from({length:24},(_,i)=>{const start=Date.parse(date+'T07:00:00-06:00')+i*3600000;return {start:new Date(start).toISOString(),end:new Date(start+3600000).toISOString()};});
 function capacity(seconds,duration=3600){if(seconds==null)return null;if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0.001||seconds>86400||!Number.isFinite(duration)||duration<=0||duration>3600)throw Error('Unit Time은 0.001~86400초/PCB로 입력하세요.');return {uph:3600/seconds,target:Math.floor(duration/seconds*0.85),margin:0.15};}
 function rate(project,input){if(!project||project.status==='archived'||!isProductionModel(M.byId(project,input.partId)))throw Error('프로젝트의 모델을 확인하세요.');if(M.isProductPart(M.byId(project,input.partId))&&!F.isFinal(project,M.byId(project,input.partId)))throw Error('IB/OB·RH/LH를 구분한 최종 파츠를 선택하세요.');if(input.unitTimeSeconds==null)throw Error('Unit Time을 입력하세요.');capacity(input.unitTimeSeconds);if(typeof input.effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)||day(input.effectiveDate+'T12:00:00-06:00')!==input.effectiveDate)throw Error('적용 생산일을 확인하세요.');return {partId:input.partId,unitTimeSeconds:input.unitTimeSeconds,effectiveDate:input.effectiveDate,margin:0.15};}
 function rateFor(rates,partId,date){return (rates||[]).filter(r=>r.partId===partId&&r.effectiveDate<=date).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||(a.recordRevision||0)-(b.recordRevision||0)||(a.recordedAt||'').localeCompare(b.recordedAt||'')).at(-1)||null;}
 const isModel=r=>r.measurementKind==='model';
 const isProductionModel=e=>M.isProductPart(e)||M.isComponentPart(e);
 const measurement=r=>[r.partId,isModel(r)?'model':r.stepId,r.lineId||'',r.machineId||'',r.unit].join('|');
 const key=r=>[measurement(r),r.start,r.end].join('|');
 function metrics(actual,target){return {actual,target,ratio:actual!=null&&target>0?actual/target*100:null,shortfall:actual!=null&&target!=null?Math.max(0,target-actual):null,excess:actual!=null&&target!=null?Math.max(0,actual-target):null};}
 function latest(rows){const result=new Map();for(const row of rows){const k=key(row),old=result.get(k);if(!old||Number(row.recordRevision||0)>=Number(old.recordRevision||0))result.set(k,row);}return [...result.values()];}
 function aggregate(rows,partId,stepId,unit){const selected=latest(rows).filter(r=>r.partId===partId&&r.stepId===stepId&&r.unit===unit).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));if(new Set(selected.map(measurement)).size>1)throw Error('라인·설비 측정 기준을 하나로 선택하세요.');for(let i=1;i<selected.length;i++)if(Date.parse(selected[i].start)<Date.parse(selected[i-1].end))throw Error('시간 구간이 겹칩니다.');const sum=k=>selected.length&&selected.every(r=>r[k]!=null)?selected.reduce((n,r)=>n+r[k],0):null;return {...metrics(sum('actual'),sum('target')),rows:selected,reasons:selected.flatMap(r=>r.reasons||[])};}
 function modelSeries(rows,partId,unit){
  const selected=latest(rows).filter(r=>isModel(r)&&r.partId===partId&&r.unit===unit).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  if(new Set(selected.map(measurement)).size>1)throw Error('라인·설비 측정 기준을 하나로 선택하세요.');
  let actual=0,target=0,completeActual=true,completeTarget=true,gaps=false;
  const timeline=selected.map((r,i)=>{if(i&&Date.parse(r.start)<Date.parse(selected[i-1].end))throw Error('시간 구간이 겹칩니다.');if(i&&Date.parse(r.start)>Date.parse(selected[i-1].end)){gaps=true;completeActual=false;completeTarget=false;}
   if(r.actual==null)completeActual=false;else actual+=r.actual;if(r.target==null)completeTarget=false;else target+=r.target;
   return {...r,...metrics(r.actual,r.target),cumulativeActual:completeActual?actual:null,cumulativeTarget:completeTarget?target:null};});
  const result=metrics(completeActual&&selected.length?actual:null,completeTarget&&selected.length?target:null),comparable=selected.filter(r=>r.target>0);
  result.ratio=selected.length&&completeActual&&completeTarget&&comparable.length?comparable.reduce((n,r)=>n+r.actual,0)/comparable.reduce((n,r)=>n+r.target,0)*100:null;
  return {...result,rows:selected,timeline,gaps,unscheduledActual:selected.filter(r=>r.target===0&&r.actual!=null).reduce((n,r)=>n+r.actual,0),reasons:selected.flatMap(r=>r.reasons||[])};
 }
 function features(input){if(!input||Object.keys(input).some(k=>!['wip','hourly'].includes(k))||typeof input.wip!=='boolean'||typeof input.hourly!=='boolean')throw Error('기능 설정을 확인하세요.');return {wip:input.wip,hourly:input.hourly};}
 function defaults(project){return {wip:['LS','MOBIS + HELLA'].includes(project.name),hourly:['LS','SMT'].includes(project.name)};}
 function parseInput(project,{partId,date=day(new Date()),text,unit='pcs'}){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||day(new Date(date+'T12:00:00-06:00'))!==date)throw Error('날짜를 확인하세요.');
  if(typeof text!=='string'||!text.trim()||text.length>100000)throw Error('시간 목표 실제 사유를 입력하세요.');
  const rows=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((line,i)=>{
   const match=line.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?[\t ]+(\S+)[\t ]+(\S+)(?:[\t ]+(.*))?$/i);
   if(!match)throw Error((i+1)+'행: 예시 9am 500 400 자재 부족');
   let hour=Number(match[1]);const period=match[3]?.toLowerCase();
   if(match[2]&&match[2]!=='00'||period&&(hour<1||hour>12)||!period&&hour>23)throw Error((i+1)+'행: 보고 시간을 정각으로 입력하세요.');
   if(period)hour=hour%12+(period==='pm'?12:0);
   const quantity=v=>{if(v==='-')return null;if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(v))throw Error((i+1)+'행: 목표·실제는 정수, 미입력은 - 입니다.');const n=Number(v.replaceAll(',',''));if(!Number.isSafeInteger(n))throw Error('수량이 너무 큽니다.');return n;};
   const end=new Date(date+'T'+String(hour).padStart(2,'0')+':00:00-06:00'),reason=match[6]?.trim();
   return {measurementKind:'model',partId,unit,start:new Date(end.getTime()-3600000).toISOString(),end:end.toISOString(),target:quantity(match[4]),actual:quantity(match[5]),reasons:reason?[{category:'unknown',text:reason,verification:'reported'}]:[]};
  });return validate(project,rows);
 }
 function changes(existing,rows,confirmCorrections=false){
  const current=latest(existing),changed=[];
  for(const row of rows){const old=current.find(r=>key(r)===key(row));
   if(old){if(Object.keys(row).filter(k=>k!=='sourceId'&&k!=='supersedesId').every(k=>JSON.stringify(row[k])===JSON.stringify(old[k])))continue;
    if(!confirmCorrections)throw Error('다른 값의 기존 기록이 있습니다. 정정을 확인하세요.');
   }else if(current.some(r=>measurement(r)===measurement(row)&&Date.parse(r.start)<Date.parse(row.end)&&Date.parse(row.start)<Date.parse(r.end)))throw Error('기존 기록과 시간 구간이 겹칩니다.');
   changed.push({...row,...(old?{supersedesId:old.id}:{})});
  }
  for(const row of changed)if(changed.some(r=>r!==row&&measurement(r)===measurement(row)&&Date.parse(r.start)<Date.parse(row.end)&&Date.parse(row.start)<Date.parse(r.end)))throw Error('입력 구간이 겹칩니다.');
  return changed;
 }
 function validate(project,rows){if(!project||project.status==='archived')throw Error('활성 프로젝트를 선택하세요.');if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('실적은 1–1,000건까지 저장하세요.');const seen=new Set();return rows.map(row=>{
  const model=row.measurementKind==='model'||!row.stepId;
  if(row.measurementKind!=null&&row.measurementKind!=='model')throw Error('측정 기준을 확인하세요.');
  const part=M.byId(project,row.partId);if(!(model?isProductionModel(part):M.isProductPart(part)))throw Error('프로젝트의 모델을 확인하세요.');
  if(M.isProductPart(part)&&!F.isFinal(project,part))throw Error('IB/OB·RH/LH를 구분한 최종 파츠를 선택하세요. 기존 상위 모델 기록은 그대로 보존됩니다.');
  if(model&&(row.stepId||row.machineId))throw Error('모델 생산량에는 공정·설비별 수량을 넣을 수 없습니다.');
  if(!model&&!G.steps(project,row.partId).some(s=>s.id===row.stepId))throw Error('프로젝트의 Part와 공정을 확인하세요.');
  const start=new Date(G.timestamp(row.start)).toISOString(),end=new Date(G.timestamp(row.end)).toISOString();if(Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>3600000||day(start)!==day(new Date(Date.parse(end)-1).toISOString()))throw Error('같은 날짜의 1시간 이하 구간을 선택하세요.');
  for(const k of ['actual','target'])if(row[k]!=null&&(!Number.isSafeInteger(row[k])||row[k]<0))throw Error('수량은 0 이상의 정수 또는 미입력이어야 합니다.');if(row.actual==null&&row.target==null)throw Error('목표 또는 실적이 필요합니다.');
  if(!['pcs','sheets','boxes','pallets'].includes(row.unit))throw Error('단위를 확인하세요.');
  if(row.lineId){const line=M.byId(project,row.lineId);if(line?.type!=='Resource'||line.resourceKind!=='line')throw Error('라인을 확인하세요.');if(!model&&!project.relations.some(r=>r.type==='operated_in'&&r.from===row.stepId&&r.to===row.lineId))throw Error('공정에 연결된 라인만 선택하세요.');}
  if(row.machineId){const machine=M.byId(project,row.machineId);if(machine?.type!=='Resource'||!project.relations.some(r=>r.type==='requires'&&r.from===row.stepId&&r.to===row.machineId))throw Error('공정에 연결된 설비만 선택하세요.');}
  const reasons=row.reasons||[];if(!Array.isArray(reasons)||reasons.length>10)throw Error('사유는 최대 10건입니다.');for(const r of reasons)if(!['material','equipment','quality','staffing','setup','other','unknown'].includes(r.category)||typeof r.text!=='string'||!r.text.trim()||r.text.length>1000||typeof (r.response||'')!=='string'||(r.response||'').length>1000||!['reported','confirmed'].includes(r.verification))throw Error('미달 사유와 확인 상태를 확인하세요.');
  const out={...(model?{measurementKind:'model'}:{}),partId:row.partId,stepId:model?'':row.stepId,lineId:row.lineId||'',machineId:row.machineId||'',start,end,actual:row.actual??null,target:row.target??null,unit:row.unit,reasons:reasons.map(r=>({category:r.category,text:r.text,response:r.response||'',verification:r.verification})),sourceId:typeof row.sourceId==='string'?row.sourceId:'',planVersion:String(row.planVersion||'1').slice(0,120)};
  if(seen.has(key(out)))throw Error('같은 시간·공정 기록이 중복됩니다.');seen.add(key(out));return out;
 });}
 const api={day,productionDay,daySlots,capacity,rate,rateFor,key,measurement,isModel,isProductionModel,parseInput,changes,metrics,latest,aggregate,modelSeries,features,defaults,validate};if(typeof module==='object')module.exports=api;else root.HourlyProduction=api;
})(globalThis);
