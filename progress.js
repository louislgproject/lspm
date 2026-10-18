(function(root){
  const M=typeof module==='object'?require('./ontology-model'):root.OntologyModel,Flow=typeof module==='object'?require('./workflow'):root.PMWorkflow,F=typeof module==='object'?require('./final-parts'):root.FinalParts;
  const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
  const aliases={fw:'fwdownload',download:'fwdownload',firmwaredownload:'fwdownload',programdownload:'fwdownload',lam:'lamassembly',visual:'visualinspection',pack:'packing'};
  const stageKey=v=>{const key=norm(String(v||'').replace(/\(\s*LS\s*\)$/i,''));return aliases[key]||key;};
  const unitKey=v=>({pc:'pcs',piece:'pcs',pieces:'pcs',ea:'pcs','개':'pcs',sheet:'sheets','시트':'sheets'}[norm(v)]||String(v||'pcs').trim().toLowerCase());
  function timestamp(v){v=String(v||'').trim();if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?$/.test(v))v=v.replace(' ','T')+(v.length===16?':00':'')+'-06:00';const m=v.match(/^(\d{4})-(\d\d)-(\d\d)T.*(?:Z|[+-]\d\d:\d\d)$/),day=m&&new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(!m||!Number.isFinite(Date.parse(v))||day.getUTCFullYear()!==+m[1]||day.getUTCMonth()!==+m[2]-1||day.getUTCDate()!==+m[3])throw Error('Choose a valid Mexico observation date and time.');return v;}
  function steps(project,partId){return Flow.productionLanes(project,{partIds:[partId]}).lanes.flatMap(l=>l.items.map(i=>i.entity)).filter(e=>!['exception','rework'].includes(e.branchKind)&&!/(ng storage|scrap)/i.test(e.productionStage||e.name));}
  function matchStep(project,partId,label){const matches=steps(project,partId).filter(s=>stageKey(s.productionStage||s.name.split('·').at(-1))===stageKey(label)||s.displayProcessName&&stageKey(s.displayProcessName)===stageKey(label)||norm(s.name)===norm(label));return matches.length===1?matches[0].id:'';}
  function cells(line){if(line.includes('\t'))return line.split('\t').map(s=>s.trim());if(line.includes(',')){const out=[];let s='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){s+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){out.push(s.trim());s='';}else s+=c;}if(quoted)throw Error('Unclosed CSV quote.');out.push(s.trim());return out;}return line.trim().split(/\s{2,}/);}
  function parse(project,text,{partId='',capturedAt='',unit='pcs'}={}){
    if(typeof text!=='string'||!text.trim()||text.length>200000)throw Error('Paste 1–200,000 characters.');
    let time=capturedAt?timestamp(capturedAt):new Date().toISOString(),part=partId,header=[],longHeader=null;const rows=[],warnings=[];
    const parts=project.entities.filter(e=>M.isProductPart(e));
    const resolvePart=name=>{const m=parts.filter(p=>norm(p.name)===norm(name)||p.sourcePartName&&norm(p.sourcePartName)===norm(name));return m.length===1?m[0].id:'';};
    const add=(label,value,row,column,t=time,p=part,u=unit)=>{if(value===''||value==='—'||value==='-'||value==null)return;const quantity=Number(String(value).replace(/,/g,''));rows.push({capturedAt:t,partId:p,partName:M.byId(project,p)?.name||'',stage:label,stepId:matchStep(project,p,label),quantity,unit:unitKey(u),row,column});};
    const lines=text.split(/\r?\n/),grid=lines.map(cells);
    const headerRow=grid.slice(0,40).findLastIndex(c=>c.some(v=>/^(?:pjt\s*명|품명|제품명|part\s*name)$/i.test(v))&&c.some(v=>/^(?:모델명|모델코드|품번|model\s*code|part\s*code)$/i.test(v)));
    if(headerRow>=0){
      const labels=grid[headerRow],partCol=labels.findIndex(v=>/^(?:pjt\s*명|품명|제품명|part\s*name)$/i.test(v)),codeCol=labels.findIndex(v=>/^(?:모델명|모델코드|품번|model\s*code|part\s*code)$/i.test(v));
      const excluded=new Set();for(let i=0;i<headerRow;i++){let group='';grid[i].forEach((v,j)=>{if(v)group=v;if(/수리.*재공|repair.*wip/i.test(group))excluded.add(j);});}
      for(let i=headerRow+1;i<grid.length;i++){
        const c=grid[i],code=c[codeCol]||'',name=c[partCol]||'';if(!code&&!name||/^(?:합계|소계|total|sum)$/i.test(code)||/^(?:합계|소계|total|sum)$/i.test(name))continue;
        const matches=parts.filter(p=>(p.modelCode||'').trim()===code&&code),p=matches.length===1?matches[0].id:'';if(!p)warnings.push('Line '+(i+1)+': model code missing or ambiguous: '+code+' ('+name+')');
        for(let j=partCol+1;j<labels.length;j++){
          const label=labels[j],value=c[j];if(excluded.has(j)||/수리|repair|^EA\s*\/\s*Box$|합계|소계|^total$|^sum$/i.test(label)||value==null||value===''||value==='-'||value==='—')continue;
          if(!label){warnings.push('Line '+(i+1)+': numeric column '+(j+1)+' has no process header.');continue;}
          add(label,value,i+1,j+1,time,p);const r=rows.at(-1);r.code=code;r.sourcePartName=name;if(p&&!r.stepId)warnings.push('Line '+(i+1)+': unmapped process '+label);
        }
      }
      if(!rows.length)warnings.push('No numeric observations found.');return {rows,warnings};
    }
    for(let i=0;i<lines.length;i++){
      const line=lines[i];if(!line.trim())continue;let m;
      if((m=line.match(/^\s*(?:part|파트)\s*:\s*(.+)$/i))){part=resolvePart(m[1]);if(!part)warnings.push('Line '+(i+1)+': Part name is missing or ambiguous.');header=[];continue;}
      if((m=line.match(/^\s*(?:unit|단위)\s*:\s*(.+)$/i))){unit=m[1];continue;}
      if((m=line.match(/^\s*(?:(?:timestamp|time|시각)\s*:\s*)?(\d{4}-\d\d-\d\d[ T].+)\s*$/i))&&!line.includes(',')&&!line.includes('\t')){time=timestamp(m[1]);continue;}
      const c=cells(line),keys=c.map(norm);
      if(keys.includes('quantity')&&keys.includes('step')&&keys.includes('timestamp')){longHeader=keys;continue;}
      if(longHeader){const get=k=>c[longHeader.indexOf(k)];const p=get('part')?resolvePart(get('part')):part;add(get('step'),get('quantity'),i+1,1,timestamp(get('timestamp')),p,get('unit')||unit);continue;}
      if(header.length){
        const named=line.match(/^(.+?)\s+[-–—:]\s+(.+)$/),tabular=c.length>1&&!/^(?:\d|[-—])/.test(c[0])&&c.slice(1).every(v=>v===''||v==='-'||v==='—'||/^-?\d[\d,.]*$/.test(v));
        if(named||tabular){const name=named?named[1].trim():c[0],values=named?(named[2].includes('\t')||named[2].includes(',')?cells(named[2]):named[2].trim().split(/\s+/)):c.slice(1),p=resolvePart(name);if(!p)warnings.push('Line '+(i+1)+': Part name is missing or ambiguous: '+name);if(values.length!==header.length)warnings.push('Line '+(i+1)+': stage/value count differs.');values.forEach((v,j)=>{if(j<header.length)add(header[j],v,i+1,j+1,time,p);});continue;}
      }
      if(header.length&&c.every(v=>v===''||v==='-'||v==='—'||/^\d+(?:,\d{3})*$/.test(v))){if(c.length>header.length)warnings.push('Line '+(i+1)+': more values than stage labels.');c.forEach((v,j)=>{if(j<header.length)add(header[j],v,i+1,j+1);});continue;}
      if(header.length&&/^\s*(?:\d+|[-—])(?:\s+(?:\d+|[-—]))*\s*$/.test(line)){const values=line.trim().split(/\s+/);if(values.length!==header.length)warnings.push('Line '+(i+1)+': stage/value count differs.');values.forEach((v,j)=>{if(j<header.length)add(header[j],v,i+1,j+1);});continue;}
      const stageNames=steps(project,part).flatMap(e=>[e.productionStage||e.name.split('·').at(-1).trim(),e.displayProcessName].filter(Boolean));
      if(c.length>1)header=c;else{
        const names=[...stageNames,'FW DOWNLOAD','ICT','Router','Integration','LAM','Stacking','EOL','Packing','Visual inspection'].sort((a,b)=>b.length-a.length);
        const pattern=new RegExp(names.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gi');header=[...line.matchAll(pattern)].map(m=>m[0]);const rest=line.replace(pattern,'').trim();if(rest)warnings.push('Line '+(i+1)+': unrecognized stage text '+rest.slice(0,60));
      }
      if(!header.length)warnings.push('Line '+(i+1)+': no stage labels recognized.');
    }
    if(!rows.length)warnings.push('No numeric observations found.');return {rows,warnings};
  }
  function validate(project,rows){if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw Error('Choose 1–10,000 WIP observations.');const seen=new Set();for(const r of rows){timestamp(r.capturedAt);const part=M.byId(project,r.partId);if(!M.isProductPart(part))throw Error('Choose a valid Part for every observation.');if(!F.isFinal(project,part))throw Error('IB/OB·RH/LH를 구분한 최종 파츠를 선택하세요. 기존 상위 모델 기록은 보존됩니다.');if(r.code&&r.code!==part.modelCode)throw Error('Model code does not match the selected Part. Register the correct code first.');if(!steps(project,r.partId).some(s=>s.id===r.stepId))throw Error('Choose a step in this Part route.');if(!Number.isSafeInteger(r.quantity)||r.quantity<0)throw Error('Invalid quantity; use a non-negative integer.');if(!['pcs','sheets','boxes','pallets'].includes(unitKey(r.unit)))throw Error('Choose pcs, sheets, boxes or pallets.');const k=[r.partId,r.stepId,Date.parse(r.capturedAt),unitKey(r.unit)].join('|');if(seen.has(k))throw Error('Duplicate Part/step/time/unit observation.');seen.add(k);}return rows;}
  function at(rows,cursor){const time=Date.parse(cursor),groups=new Map();for(const r of rows){if(Date.parse(r.capturedAt)>time)continue;const key=[r.partId,r.stepId,unitKey(r.unit)].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}return [...groups.values()].map(list=>{list.sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||String(a.createdAt||'').localeCompare(String(b.createdAt||'')));const unique=[...new Map(list.map(r=>[Date.parse(r.capturedAt),r])).values()],last=unique.at(-1),prev=unique.at(-2),trio=unique.slice(-3);return {...last,unit:unitKey(last.unit),stale:Date.parse(last.capturedAt)<time,delta:prev?last.quantity-prev.quantity:null,previous:prev||null,accumulating:trio.length===3&&trio[1].quantity>trio[0].quantity&&trio[2].quantity>trio[1].quantity};});}
  function projection(p){const steps=p.nodes.filter(n=>n.entity.type==='Production Step'&&!['exception','rework'].includes(n.entity.branchKind)&&!/(ng storage|scrap)/i.test(n.entity.productionStage||n.entity.name)),nodes=steps.flatMap(n=>n.partIds.map(partId=>({...n,id:partId+'::'+n.id,partIds:[partId]}))),ids=new Set(nodes.map(n=>n.id)),edges=[];for(const e of p.edges.filter(e=>e.type==='precedes'))for(const partId of new Set(nodes.filter(n=>n.entity.id===e.from).flatMap(n=>n.partIds))){if(e.partIds?.length&&!e.partIds.includes(partId))continue;const from=partId+'::'+e.from,to=partId+'::'+e.to;if(ids.has(from)&&ids.has(to))edges.push({...e,from,to,partIds:[partId]});}return {...p,nodes,edges,unlinked:[]};}
  function registerModel(project,{basePartId,modelCode='',name,side='',inOut='',verticalPosition='',codeNamespace='LS MES',finalPart=false}){
    const base=M.byId(project,basePartId);if(!M.isProductPart(base))throw Error('Choose an existing route Part.');modelCode=String(modelCode||'').trim();if((!modelCode&&!finalPart)||modelCode.length>120)throw Error('Model code required, up to 120 characters.');if(modelCode&&project.entities.some(p=>p.modelCode===modelCode&&(p.codeNamespace||'LS MES')===codeNamespace))throw Error('Model code already exists.');if(finalPart){if(!name?.trim()||project.entities.some(p=>M.isProductPart(p)&&norm(F.label(p))===norm(name)))throw Error('이미 등록된 최종 파츠입니다. 기존 항목을 선택하세요.');if(!['','IB','OB'].includes(inOut)||!['','RH','LH'].includes(side))throw Error('IB/OB·RH/LH를 확인하세요.');}const route=steps(project,basePartId);if(!route.length)throw Error('Base Part has no confirmed route.');
    const made=M.addEntity(project,{type:'Part',name:name||base.name,itemKind:'product',modelCode,codeNamespace,sourcePartName:name||base.name,mappingState:'confirmed',productionFamily:base.productionFamily||'',productFamily:base.productFamily||'',side,inOut,verticalPosition,context:'Explicit model mapping; shares confirmed route with '+base.name});M.addRelation(project,{type:'part_of',from:made.id,to:base.id,evidence:'Explicit model registration'});for(const step of route)M.addRelation(project,{type:'applies_to',from:step.id,to:made.id,evidence:'Explicitly confirmed shared model route'});project.workstreams=project.workstreams||{};project.workstreams[made.id]=['production'];return made;
  }
  const api={parse,validate,at,projection,steps,timestamp,unitKey,registerModel};if(typeof module==='object')module.exports=api;else root.ProductionProgress=api;
})(typeof globalThis==='undefined'?this:globalThis);
