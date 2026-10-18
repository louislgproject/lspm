'use strict';
const {randomUUID}=require('node:crypto');
const H=require('./hourly'),S=require('./sample-preparation'),D=require('./cloud-domain');
module.exports=function({db,load,read,snapshot,rowDiff,putSettings}){
 function* project(id){const p=(yield* load()).projects.find(p=>p.id===id);if(!p)throw Error('Unknown project.');return p;}
 function* transaction({projectId,revision},label,write){
  yield db.exec('BEGIN IMMEDIATE');
  try{
   const w=yield* load(),p=w.projects.find(p=>p.id===projectId);
   if(w.revision!==revision)throw Error('STALE_REVISION');if(!p||p.status==='archived')throw Error('Open an active project.');
   const before=yield* snapshot(),result=yield* write(p),rows=rowDiff(before,yield* snapshot()),now=new Date().toISOString();
   yield db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(revision+1));
   yield db.prepare('INSERT INTO change_sets(id,scope,recorded_at,revision,items_json,rows_json,acknowledged_at,reverted_at,revert_of) VALUES (?,?,?,?,?,?,?,NULL,NULL)').run('change-'+randomUUID(),projectId,now,revision+1,JSON.stringify([{action:'Saved',label}]),JSON.stringify(rows),now);
   yield db.exec('COMMIT');return {revision:revision+1,...result};
  }catch(e){yield db.exec('ROLLBACK');throw e;}
 }
 function* listHourly(id){yield* project(id);return (yield* read('SELECT id,data_json,recorded_at,revision FROM hourly_records WHERE project_id=? ORDER BY revision,id',id)).map(r=>({...JSON.parse(r.data_json),id:r.id,recordedAt:r.recorded_at,recordRevision:r.revision}));}
 function* samplePreparationList(id){yield* project(id);return S.latest((yield* read('SELECT data_json,recorded_at,revision FROM sample_preparation_records WHERE project_id=? ORDER BY revision,version,id',id)).map(r=>({...JSON.parse(r.data_json),recordedAt:r.recorded_at,recordRevision:r.revision})));}
 function* listProgress(id){
  yield* project(id);
  const snapshots=(yield* read('SELECT id,captured_at,sheet,created_at FROM wip_snapshots WHERE project_id=? ORDER BY captured_at,created_at LIMIT 2000',id)).map(r=>({id:r.id,capturedAt:r.captured_at,createdAt:r.created_at,unit:r.sheet.startsWith('Progress · ')?r.sheet.slice(11):'pcs'})),byId=new Map(snapshots.map(s=>[s.id,s]));
  const rows=(yield* read('SELECT c.* FROM wip_counts c JOIN wip_snapshots s ON s.id=c.snapshot_id WHERE s.project_id=? ORDER BY s.captured_at,s.created_at LIMIT 100000',id)).filter(r=>byId.has(r.snapshot_id)&&r.part_id&&r.step_id).map(r=>({...byId.get(r.snapshot_id),snapshotId:r.snapshot_id,partId:r.part_id,stepId:r.step_id,code:r.product_code,partName:r.part_label,stage:r.stage_label,row:r.source_row,column:r.source_column,quantity:r.quantity}));
  return {snapshots,rows};
 }
 function* hourlySave(input){
  if((yield* load()).revision!==input.revision)throw Error('STALE_REVISION');if(typeof (input.text??'')!=='string'||(input.text||'').length>100000)throw Error('Invalid source text.');
  const changed=H.changes(yield* listHourly(input.projectId),H.validate(yield* project(input.projectId),input.rows),input.confirmCorrections===true);
  if(!changed.length)return {revision:input.revision,duplicate:true};
  return yield* transaction(input,'Hourly production records saved',function*(p){
   let sourceId;if(input.text){sourceId='source-'+randomUUID();yield db.prepare('INSERT INTO sources(id,kind,filename,mime_type,content,created_at) VALUES (?,?,?,?,?,?)').run(sourceId,'text','Hourly production report','text/plain',Buffer.from(input.text),new Date().toISOString());}
   const ids=[];for(const row of changed){const id='hourly-'+randomUUID();ids.push(id);yield db.prepare('INSERT INTO hourly_records(id,project_id,data_json,recorded_at,revision) VALUES (?,?,?,?,?)').run(id,p.id,JSON.stringify({...row,...(sourceId?{sourceId}:{})}),new Date().toISOString(),input.revision+1);}return {ids};
  });
 }
 function* featureSave(input){const features=H.features(input.features);return yield* transaction(input,'Project feature settings saved',function*(){yield* putSettings(input.projectId,'features',features);return {features};});}
 function* hourlyRateSave(input){const rate=H.rate(yield* project(input.projectId),input);return yield* transaction(input,'Model Unit Time standard saved',function*(){const w=yield* load(),rates=[...(w.viewSettings[input.projectId]?.hourlyRates||[]),{...rate,recordRevision:input.revision+1,recordedAt:new Date().toISOString()}];yield* putSettings(input.projectId,'hourlyRates',rates);return {rate};});}
 function* samplePreparationSave(input){
  const result=yield* transaction(input,'Sample preparation checksheet saved',function*(p){
   const value=S.validate(p,input.sheet),prior=yield db.prepare('SELECT project_id,data_json FROM sample_preparation_records WHERE sheet_id=? ORDER BY version DESC LIMIT 1').get(value.id),old=prior?JSON.parse(prior.data_json):null;
   if(prior&&prior.project_id!==p.id)throw Error('Checksheet project identity cannot change.');if(value.version!==(old?.version??0))throw Error('SHEET_VERSION_CONFLICT');
   if(old&&['partId','runName','templateVersion'].some(k=>old[k]!==value[k]))throw Error('Run/model/template identity cannot change. Create a new run.');
   const sheet={...value,version:value.version+1};yield db.prepare('INSERT INTO sample_preparation_records(id,project_id,sheet_id,version,data_json,recorded_at,revision) VALUES (?,?,?,?,?,?,?)').run('sample-preparation-record-'+randomUUID(),p.id,sheet.id,sheet.version,JSON.stringify(sheet),new Date().toISOString(),input.revision+1);return {sheet};
  });return {...result,workspace:yield* load()};
 }
 function* saveProgress(input){
  const G=require('./progress'),p=yield* project(input.projectId);G.validate(p,input.rows);
  const uploaded=new Date().toISOString(),draft=D.upload(p,input,uploaded,randomUUID());
  if(!input.uploadTime)draft.rows=draft.rows.map((row,i)=>({...row,capturedAt:G.timestamp(input.rows[i].capturedAt),snapshotId:row.snapshotId+'-'+G.timestamp(input.rows[i].capturedAt)}));
  const existing=(yield* listProgress(p.id)).rows;
  for(const row of draft.rows){const previous=existing.filter(r=>r.partId===row.partId&&r.stepId===row.stepId&&r.unit===row.unit&&r.capturedAt===row.capturedAt).at(-1);if(previous&&previous.quantity!==row.quantity&&!input.confirmCorrections)throw Error('Confirm corrections to existing WIP observations.');}
  const result=yield* transaction(input,'Production Progress · WIP observations',function*(){
   const sourceId='source-'+randomUUID(),event={...draft.event};yield db.prepare('INSERT INTO sources(id,kind,filename,mime_type,content,created_at) VALUES (?,?,?,?,?,?)').run(sourceId,'text','Production Progress · WIP','text/plain',Buffer.from(input.text),uploaded);
   event.sourceId=sourceId;yield db.prepare('INSERT INTO entities(id,type,data_json) VALUES (?,?,?)').run(event.id,event.type,JSON.stringify(event));
   yield db.prepare('INSERT INTO project_memberships(project_id,entity_id) VALUES (?,?)').run(p.id,event.id);
   for(const link of draft.links)yield db.prepare('INSERT INTO relations(id,type,from_id,to_id,scope_project_id,data_json) VALUES (?,?,?,?,?,?)').run(link.id,link.type,link.from,link.to,p.id,JSON.stringify(link));
   const snapshots=new Set();let n=0;for(const row of draft.rows){if(!snapshots.has(row.snapshotId)){snapshots.add(row.snapshotId);yield db.prepare('INSERT INTO wip_snapshots(id,project_id,captured_at,filename,sheet,created_at) VALUES (?,?,?,?,?,?)').run(row.snapshotId,p.id,row.capturedAt,'Production Progress','Progress · '+row.unit,uploaded);}
    yield db.prepare('INSERT INTO wip_counts(id,snapshot_id,source_row,source_column,product_code,part_label,part_id,stage_label,step_id,quantity) VALUES (?,?,?,?,?,?,?,?,?,?)').run('count-'+randomUUID(),row.snapshotId,++n,row.column,row.code,p.entities.find(e=>e.id===row.partId).name,row.partId,p.entities.find(e=>e.id===row.stepId).name,row.stepId,row.quantity);}
   return {eventIds:[event.id],snapshotIds:[...snapshots]};
  });return {...result,workspace:yield* load()};
 }
 function* historyList(q){return D.query(yield* load(),q);}
 function* historyDetail(id,scope){
  const w=yield* load(),result=D.detail(w,id,scope),sources=[],sourceIds=new Set();
  const append=(source,evidence,excerpt='')=>{if(source?.id)sourceIds.add(source.id);sources.push({sourceId:source?.id||evidence?.sourceId||'',name:evidence?.name||source?.filename||'Original source',excerpt,text:evidence?.rawLog||(source&&source.mime_type!=='application/pdf'?Buffer.from(source.content).toString('utf8'):''),metadata:source?.metadata_json?JSON.parse(source.metadata_json):{},attachment:source?.mime_type==='application/pdf'});};
  for(const link of result.links.filter(r=>r.from===id&&r.type==='supported_by')){const evidence=w.library.entities.find(e=>e.id===link.to),source=evidence?.sourceId?yield db.prepare('SELECT * FROM sources WHERE id=?').get(evidence.sourceId):null;append(source,evidence,link.sourceExcerpt||'');}
  const direct=result.event.sourceId||(id.startsWith('cloud-event-')?'cloud-progress-source-'+id.slice('cloud-event-'.length):'');
  if(direct&&!sourceIds.has(direct)){const source=yield db.prepare('SELECT * FROM sources WHERE id=?').get(direct);if(source)append(source,null);}
  return {...result,links:result.links.map(link=>({...link,fromName:w.library.entities.find(e=>e.id===link.from)?.name||link.from,toName:w.library.entities.find(e=>e.id===link.to)?.name||link.to})),sources,proposals:[]};
 }
 function* historyJobs(scope){if(scope!=='library')yield* project(scope);return (yield* read('SELECT * FROM ingestion_jobs ORDER BY created_at')).filter(r=>JSON.parse(r.draft_json||'{}').scope===scope).map(r=>({id:r.id,jobId:r.id,status:r.status,draft:JSON.parse(r.draft_json||'{}').draft||{events:[]}})).filter(j=>Array.isArray(j.draft.events));}
 return {listHourly,samplePreparationList,listProgress,hourlySave,featureSave,hourlyRateSave,samplePreparationSave,saveProgress,historyList,historyDetail,historyJobs};
};
