'use strict';
const fs=require('node:fs');
const {createHash,randomBytes}=require('node:crypto');
const M=require('../ontology-model');
const H=require('../history');
const {createManagementApi}=require('./supabase-management');
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>createHash('sha256').update(value).digest('hex');
const sqlJson=value=>"convert_from(decode('"+Buffer.from(canonical(value)).toString('hex')+"','hex'),'UTF8')::jsonb";
const AREAS=['production','development','materials','quality','delivery','equipment'];

// The agent reads the conversation/file and supplies sourced facts; this is a
// storage adapter, not a model that can read arbitrary chats on a schedule.
function compile(input,workspace){
 if(input?.schemaVersion!==1||!M.isTimestamp(input.recordedAt))throw Error('A stable recordedAt timestamp and schemaVersion:1 are required.');
 const source=input.source;
 if(!source||typeof source.filename!=='string'||!source.filename.trim()||typeof source.text!=='string'||!source.text.trim()||!source.origin||typeof source.origin!=='object')throw Error('Retain the source text, filename and origin identifiers.');
 const bytes=source.base64?Buffer.from(source.base64,'base64'):Buffer.from(source.text);
 if(source.base64&&bytes.toString('base64')!==source.base64)throw Error('Invalid source base64.');
 if(bytes.length>200000)throw Error('This adapter supports retained sources up to 200 KB; transfer larger attachments separately.');
 if(!Array.isArray(input.events)||!input.events.length||input.events.length>50)throw Error('Supply 1–50 reviewed business Events.');
 const sourceKey=digest(canonical([source.origin,digest(bytes)])),sourceId='business-source-'+sourceKey;
 const evidenceId='business-evidence-'+sourceKey;
 const projects=new Map(workspace.projects.map(p=>[p.id,p]));
 const existing=new Map(workspace.entities.map(e=>[e.id,e]));
 const changes=[],entities=[],relations=[],memberships=new Set();
 const pushEntity=entity=>{entities.push(entity);changes.push({table:'entities',id:entity.id,row:{id:entity.id,type:entity.type,data_json:canonical(entity)}});};
 const link=(from,type,to,scope=null)=>{const id='business-link-'+digest(JSON.stringify([from,type,to,scope]));const relation={id,from,type,to,scopeProjectId:scope};relations.push(relation);changes.push({table:'relations',id,row:{id,type,from_id:from,to_id:to,scope_project_id:scope,data_json:canonical(relation)}});};
 const member=(projectId,entityId)=>{const key=JSON.stringify([projectId,entityId]);if(memberships.has(key))return;memberships.add(key);changes.push({table:'project_memberships',id:key,row:{project_id:projectId,entity_id:entityId}});};
 changes.push({table:'sources',id:sourceId,row:{id:sourceId,kind:'business-update',filename:source.filename,mime_type:source.mimeType||'text/plain',content:bytes.toString('base64'),created_at:input.recordedAt,metadata_json:canonical({origin:source.origin,contentSha256:digest(bytes),extractedText:source.base64?source.text:undefined})}});
 pushEntity({id:evidenceId,type:'Evidence',name:source.filename.slice(0,120),status:'active',privacy:'local_only',sourceId,historySource:true});
 const candidateIds=new Set();
 for(const item of input.events){
  if(typeof item.key!=='string'||!item.key||candidateIds.has(item.key))throw Error('Each Event needs a distinct stable key.');candidateIds.add(item.key);
  if(!AREAS.includes(item.area))throw Error('Choose a company business area; software development is excluded.');
  if(typeof item.sourceExcerpt!=='string'||!item.sourceExcerpt.trim()||!source.text.includes(item.sourceExcerpt))throw Error('Every Event needs an exact excerpt from the retained source.');
  if(typeof item.title!=='string'||!item.title.trim()||item.title.length>120||typeof item.summary!=='string'||item.summary.length>2000)throw Error('Supply a title up to 120 characters and a summary up to 2,000 characters.');
  const projectIds=item.projectIds||[],subjectIds=item.subjectIds||[];
  if(!Array.isArray(projectIds)||!Array.isArray(subjectIds)||new Set(projectIds).size!==projectIds.length||new Set(subjectIds).size!==subjectIds.length)throw Error('Invalid scope or subject list.');
  for(const id of projectIds)if(!projects.has(id)||projects.get(id).status==='archived')throw Error('Choose an existing active project.');
  for(const id of subjectIds)if(!existing.has(id))throw Error('Unknown ontology subject: '+id);
  const record={...item.record,schemaVersion:1,recordClass:'business',recordedAt:input.recordedAt,timezone:'America/Mexico_City',scope:{kind:projectIds.length?'explicit_projects':'unassigned',projectIds},facets:[...new Set([...(item.record?.facets||[]),item.area])],observations:[{sourceId,sourceExcerpt:item.sourceExcerpt}],unresolved:item.record?.unresolved||[]};
  H.validateEvent(record);
  const id='business-event-'+digest(JSON.stringify([sourceKey,item.key]));
  pushEntity({id,type:'Event',name:item.title,context:item.summary,status:'active',privacy:'local_only',sourceId,eventRecord:record});
  link(id,'supported_by',evidenceId);
  for(const subject of subjectIds)link(id,'records_on',subject,projectIds.length===1?projectIds[0]:null);
  for(const project of projectIds){member(project,id);member(project,evidenceId);}
  if(item.followsUpId){if(existing.get(item.followsUpId)?.type!=='Event')throw Error('Unknown prior Event.');link(id,'follows_up',item.followsUpId);}
 }
 const referenced=new Set(relations.flatMap(r=>[r.from,r.to]));
 const minimalExisting=workspace.entities.filter(e=>referenced.has(e.id)).map(({id,type,name})=>({id,type,name,status:'active'}));
 M.validateStore({entities:[...minimalExisting.filter(e=>!entities.some(n=>n.id===e.id)),...entities],relations});
 const batch={key:digest(canonical(changes)),changes};
 if(Buffer.byteLength(JSON.stringify(batch))>390000)throw Error('Batch exceeds the existing publisher limit; split it into smaller sources.');
 return batch;
}

function applySql(batch){
 const token=randomBytes(32).toString('hex');
 return `DO $business_update$ DECLARE owner uuid; result jsonb; BEGIN
 SELECT owner_id INTO STRICT owner FROM pm.publication WHERE singleton=true;
 INSERT INTO pm.publisher_devices(token_hash,owner_id,name) VALUES(encode(extensions.digest('${token}','sha256'),'hex'),owner,'Transient cloud business update');
 result:=public.pm_ingest_local_history('${token}',${sqlJson(batch)});
 IF jsonb_array_length(result->'conflicts')>0 THEN RAISE EXCEPTION 'BUSINESS_UPDATE_CONFLICT'; END IF;
 DELETE FROM pm.publisher_batches WHERE token_hash=encode(extensions.digest('${token}','sha256'),'hex');
 DELETE FROM pm.publisher_devices WHERE token_hash=encode(extensions.digest('${token}','sha256'),'hex');
 END $business_update$;`;
}

function verificationSql(batch){
 return `WITH target AS (SELECT owner_id FROM pm.publication WHERE singleton=true), expected AS (SELECT value AS item FROM jsonb_array_elements(${sqlJson(batch.changes)}))
 SELECT (SELECT value::int FROM pm.meta,target WHERE pm.meta.owner_id=target.owner_id AND key='revision') AS revision,
 count(*)::int AS expected,
 count(*) FILTER(WHERE CASE item->>'table'
 WHEN 'entities' THEN EXISTS(SELECT 1 FROM pm.entities e,target WHERE e.owner_id=target.owner_id AND e.id=item->>'id' AND e.data_json::jsonb=(item->'row'->>'data_json')::jsonb)
 WHEN 'relations' THEN EXISTS(SELECT 1 FROM pm.relations r,target WHERE r.owner_id=target.owner_id AND r.id=item->>'id' AND r.data_json::jsonb=(item->'row'->>'data_json')::jsonb)
 WHEN 'sources' THEN EXISTS(SELECT 1 FROM pm.sources s,target WHERE s.owner_id=target.owner_id AND s.id=item->>'id' AND s.content=decode(item->'row'->>'content','base64') AND s.metadata_json::jsonb=(item->'row'->>'metadata_json')::jsonb)
 WHEN 'project_memberships' THEN EXISTS(SELECT 1 FROM pm.project_memberships m,target WHERE m.owner_id=target.owner_id AND m.project_id=item->'row'->>'project_id' AND m.entity_id=item->'row'->>'entity_id') ELSE false END)::int AS verified FROM expected;`;
}

async function record(input,{query,apply=false,enqueue=false}){
 const [workspace]=await query("SELECT jsonb_build_object('projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'status',p.status)) FROM pm.projects p WHERE p.owner_id=x.owner_id),'[]'::jsonb),'entities',COALESCE((SELECT jsonb_agg(e.data_json::jsonb) FROM pm.entities e WHERE e.owner_id=x.owner_id),'[]'::jsonb)) AS workspace FROM pm.publication x WHERE singleton=true");
 if(!workspace)throw Error('Published owner workspace is missing.');
 const batch=compile(input,workspace.workspace);
 if(enqueue){
  const id='business-inbox-'+digest(canonical(input)),data=sqlJson({id,input});
  await query(`INSERT INTO pm.sources(owner_id,id,kind,filename,mime_type,content,created_at,metadata_json)
   SELECT p.owner_id,x->>'id','business-inbox','Reviewed company update','application/json',convert_to((x->'input')::text,'UTF8'),x->'input'->>'recordedAt','{"status":"pending"}'
   FROM pm.publication p CROSS JOIN (SELECT ${data} AS x) payload WHERE p.singleton=true ON CONFLICT(owner_id,id) DO NOTHING`);
  const [saved]=await query(`SELECT count(*)::int AS retained,min(s.metadata_json::jsonb->>'status') AS status FROM pm.sources s JOIN pm.publication p ON s.owner_id=p.owner_id AND p.singleton WHERE s.id='${id}' AND convert_from(s.content,'UTF8')::jsonb=${sqlJson(input)}`);
  if(saved.retained!==1)throw Error('Inbox verification failed.');
  return {queued:saved.status==='pending',status:saved.status,id,events:input.events.length};
 }
 if(!apply)return {dryRun:true,events:input.events.length,records:batch.changes.length};
 await query(applySql(batch));
 const [result]=await query(verificationSql(batch));
 if(result.expected!==result.verified)throw Error('Remote verification incomplete. Retry the identical batch.');
 return {verified:true,events:input.events.length,revision:result.revision,records:result.expected,verifiedRecords:result.verified};
}

async function syncPending({query}){
 const pending=await query("SELECT s.id,encode(s.content,'base64') AS content FROM pm.sources s JOIN pm.publication p ON s.owner_id=p.owner_id AND p.singleton WHERE s.kind='business-inbox' AND s.metadata_json::jsonb->>'status'='pending' ORDER BY s.created_at,s.id LIMIT 100");
 let batches=0,events=0;
 for(const item of pending){
  const input=JSON.parse(Buffer.from(item.content,'base64').toString()),result=await record(input,{query,apply:true});
  const data=sqlJson({id:item.id,input,result});
  const [marked]=await query(`WITH acknowledged AS (UPDATE pm.sources s SET metadata_json=jsonb_build_object('status','applied','verifiedAt',now(),'result',x->'result')::text
   FROM pm.publication p CROSS JOIN (SELECT ${data} AS x) payload WHERE p.singleton=true AND s.owner_id=p.owner_id AND s.id=x->>'id' AND convert_from(s.content,'UTF8')::jsonb=x->'input' RETURNING s.id) SELECT count(*)::int AS count FROM acknowledged`);
  if(marked.count!==1)throw Error('Inbox acknowledgment incomplete. Retry on the next execution.');
  batches++;events+=result.events;
 }
 return {verified:true,batches,events};
}

if(require.main===module)(async()=>{
 const filename=process.argv[2];if(!filename)throw Error('Usage: node scripts/record-business-update.js batch.json [--queue|--apply] or --sync-pending');
 if(!process.env.SUPABASE_ACCESS_TOKEN)throw Error('SUPABASE_ACCESS_TOKEN is not connected.');
 const api=createManagementApi({project:'ahzpuefosoajwwgbfhng',token:process.env.SUPABASE_ACCESS_TOKEN});
 const query=query=>api('/database/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
 if(filename==='--sync-pending')console.log(JSON.stringify(await syncPending({query})));
 else{const input=JSON.parse(fs.readFileSync(filename,'utf8'));console.log(JSON.stringify(await record(input,{query,apply:process.argv.includes('--apply'),enqueue:process.argv.includes('--queue')})));}
})().catch(e=>{console.error(require('./supabase-management').redact(e.message,process.env.SUPABASE_ACCESS_TOKEN));process.exitCode=1;});
module.exports={compile,applySql,verificationSql,record,syncPending};
