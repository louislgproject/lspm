'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process'),{redact}=require('./firebase-transfer'),M=require('./ontology-model'),H=require('./history');
const ROOMS=['453981707667079','461913194057523','473535309242980','481868546664117'];
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function normalizeMessages(messages){
  if(!Array.isArray(messages))throw Error('INVALID_MESSAGES');const unique=new Map();
  for(const raw of messages){
    if(!ROOMS.includes(raw.chatId))throw Error('ROOM_NOT_ALLOWED');
    if(!['logId','authorId'].every(k=>typeof raw[k]==='string'&&/^\d{1,30}$/.test(raw[k])))throw Error('INVALID_MESSAGE_ID');
    if(typeof raw.text!=='string'||!Number.isInteger(raw.type)||!H.day(raw.time)||!Number.isFinite(Date.parse(raw.time)))throw Error('INVALID_MESSAGE');
    const key=raw.chatId+'|'+raw.logId,originalHash=hash(raw.text),row={...raw,originalHash,text:redact(raw.text),senderNameCandidates:[...new Set(raw.senderNameCandidates||[raw.sender])]};
    const old=unique.get(key);if(old){
      if(['authorId','time','type','originalHash'].some(k=>old[k]!==row[k]))throw Error('CONFLICTING_ORIGINAL');
      old.senderNameCandidates=[...new Set([...old.senderNameCandidates,...row.senderNameCandidates])];
    }else unique.set(key,row);
  }
  // Each committed batch must be a per-room log-ID prefix so retries cannot skip originals.
  return [...unique.values()].sort((a,b)=>a.chatId.localeCompare(b.chatId)||(BigInt(a.logId)<BigInt(b.logId)?-1:BigInt(a.logId)>BigInt(b.logId)?1:0));
}
function createRpc(config,fetchImpl=fetch){
  if(typeof config.token!=='string'||config.token.length<32||typeof config.publishableKey!=='string')throw Error('KAKAO_CLOUD_NOT_CONFIGURED');
  return async(name,args={})=>{
    if(!['pm_kakao_context','pm_kakao_collect','pm_kakao_review','pm_history_sync_status'].includes(name))throw Error('RPC_NOT_ALLOWED');
    const response=await fetchImpl('https://ahzpuefosoajwwgbfhng.supabase.co/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({...args,p_token:config.token}),signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('KAKAO_CLOUD_REQUEST_FAILED_'+response.status);return response.json();
  };
}
function readMessages(checkpoints){
  const python=process.env.KAKAO_PYTHON||path.join(os.homedir(),'.local/share/kakaotalk-mcp/.venv/bin/python');
  try{return JSON.parse(execFileSync(python,[path.join(__dirname,'kakao-cloud-reader.py')],{input:JSON.stringify(checkpoints),encoding:'utf8',timeout:50000,maxBuffer:8000000,stdio:['pipe','pipe','pipe']}));}
  catch{throw Error('AUTHORIZED_KAKAO_READ_FAILED');}
}
async function collect({rpc,readMessages:read=readMessages}){
  const context=await rpc('pm_kakao_context'),readResult=await read(context.checkpoints);
  if(readResult.dmVerified!==true)throw Error('KAKAO_DM_NOT_VERIFIED');
  const messages=normalizeMessages(readResult.messages);let batch=[],bytes=0,added=0,duplicates=0,checkpoints=context.checkpoints;
  async function flush(){if(!batch.length)return;const result=await rpc('pm_kakao_collect',{p_messages:batch});added+=result.added;duplicates+=result.duplicates;checkpoints=result.checkpoints;batch=[];bytes=0;}
  for(const row of messages){const size=Buffer.byteLength(JSON.stringify(row));if(size>440000)throw Error('KAKAO_MESSAGE_TOO_LARGE');if(batch.length>=100||bytes+size>440000)await flush();batch.push(row);bytes+=size;}await flush();
  return{added,duplicates,checkpoints,byRoom:Object.fromEntries(ROOMS.map(id=>[id,messages.filter(m=>m.chatId===id).length]))};
}
function buildReview(context,input){
  if(!Array.isArray(input.items)||!Array.isArray(input.events||[])||!Array.isArray(context.pending)||!context.graph)throw Error('INVALID_REVIEW');
  const sourceMap=new Map(context.pending.map(s=>[s.sourceId,s])),items=new Map(input.items.map(i=>[i.sourceId,i]));
  if(items.size!==input.items.length||!items.size)throw Error('INVALID_REVIEW_ITEMS');
  for(const item of items.values())if(!sourceMap.has(item.sourceId)||!['event','source_only','unresolved'].includes(item.disposition)||typeof item.reason!=='string')throw Error('SOURCE_NOT_IN_REVIEW');
  const fetchedAt=new Date(context.fetchedAt).toISOString();
  const key=hash({items:input.items,events:input.events||[]}),changes=[],byId=new Map(context.graph.entities.map(e=>[e.id,e])),graph={version:1,entities:[...context.graph.entities],relations:[...context.graph.relations]},events=new Map();
  const put=e=>{if(byId.has(e.id))throw Error('REVIEW_OBJECT_ALREADY_EXISTS');M.validateStore({version:1,entities:[e],relations:[]});byId.set(e.id,e);graph.entities.push(e);changes.push({table:'entities',id:e.id,row:{id:e.id,type:e.type,data_json:JSON.stringify(e)}});};
  const link=(from,type,to,extra={})=>{const id='kakao-link-'+hash([from,type,to]).slice(0,32);if(changes.some(c=>c.id===id))return;const r={id,type,from,to,scopeProjectId:null,evidence:'Reviewed original approved Kakao source',...extra},error=M.validateRelation(graph,r);if(error)throw Error('INVALID_REVIEW_RELATION');graph.relations.push(r);changes.push({table:'relations',id,row:{id,type,from_id:from,to_id:to,scope_project_id:null,data_json:JSON.stringify(r)}});};
  for(const spec of input.events||[]){
    if(typeof spec.key!=='string'||!spec.key||events.has(spec.key)||!Array.isArray(spec.sourceIds)||!spec.sourceIds.length)throw Error('INVALID_EVENT_KEY');
    if(spec.sourceIds.some(id=>!items.has(id)))throw Error('SOURCE_NOT_IN_REVIEW');
    const first=sourceMap.get(spec.reporterSourceId||spec.sourceIds[0]);if(!first||!spec.sourceIds.includes(first.sourceId)||[0,2,27,51].includes(first.metadata.sourceType))throw Error('INVALID_REPORTER_SOURCE');
    const meta=first.metadata,author=String(meta.senderId||meta.authorId||'');if(!/^\d+$/.test(author))throw Error('INVALID_REPORTER_SOURCE');
    const reporter='kakao-person-'+author,old=byId.get(reporter);
    if(old){if(old.type!=='Person'||old.kakaoAuthorId!==author)throw Error('REPORTER_IDENTITY_CONFLICT');}
    else put({id:reporter,type:'Person',name:meta.senderName||'Kakao account · '+author,status:'active',privacy:'local_only',kakaoAuthorId:author,sourceEvidenceIds:[first.sourceId],context:'Sender account only. No inferred employer, role or identity merge.'});
    const projectIds=[...new Set(spec.projectIds||[])];for(const id of projectIds)if(!context.projects.some(p=>p.id===id&&p.status==='active'))throw Error('INVALID_REVIEW_SCOPE');
    const record={schemaVersion:1,recordClass:'business',kind:spec.kind,statementMode:spec.statementMode,verification:'reported',lifecycle:'active',importance:spec.importance||'normal',occurredAt:spec.occurredAt||null,occurredDate:null,reportedAt:meta.sentAt||null,recordedAt:fetchedAt,effectiveAt:null,timePrecision:spec.occurredAt?'exact':'unknown',timezone:'America/Mexico_City',scope:projectIds.length?{kind:'explicit_projects',projectIds}:{kind:'unassigned',projectIds:[]},visibility:'local_only',facets:['production'],observations:spec.sourceIds.map(id=>{const s=sourceMap.get(id);return{sourceId:id,chatId:s.metadata.roomId,logId:s.metadata.externalId,authorId:s.metadata.senderId||s.metadata.authorId,sentAt:s.metadata.sentAt};}),unresolved:spec.unresolved||[],reporterLabel:meta.senderName||'',...(spec.peopleMentions?{peopleMentions:spec.peopleMentions}:{})};
    H.validateEvent(record);if(typeof spec.title!=='string'||!spec.title.trim()||spec.title.length>180||typeof spec.summary!=='string')throw Error('INVALID_EVENT_TEXT');
    const event={id:'kakao-event-'+hash([key,spec.key]).slice(0,40),type:'Event',name:spec.title.trim(),status:'active',context:spec.summary,eventRecord:record,privacy:'local_only',recordedAt:record.recordedAt};put(event);events.set(spec.key,{event,spec});
    link(event.id,'reported_by',reporter);
    for(const id of spec.subjectIds||[]){if(!byId.has(id))throw Error('UNKNOWN_SUBJECT');link(event.id,'records_on',id,{historyRole:'subject'});}
    for(const sourceId of spec.sourceIds){const source=sourceMap.get(sourceId),id='kakao-evidence-'+hash(sourceId).slice(0,40);
      if(!byId.has(id))put({id,type:'Evidence',name:(source.metadata.roomName||source.metadata.roomId)+' · '+source.metadata.externalId,status:'active',privacy:'local_only',sourceId,historySource:true,context:'Original chat account, message ID, timestamps and name variants retained in cloud source metadata.'});
      link(event.id,'supported_by',id,{sourceExcerpt:String(source.text||'').slice(0,4000)});
    }
  }
  for(const {event,spec}of events.values())if(spec.followsUpKey||spec.followsUpId){const target=spec.followsUpKey?events.get(spec.followsUpKey)?.event.id:spec.followsUpId;if(!target)throw Error('INVALID_FOLLOW_UP');link(event.id,'follows_up',target);}
  M.validateStore(graph);
  return{key,items:[...items.values()].map(item=>{const eventIds=[...events.values()].filter(e=>e.spec.sourceIds.includes(item.sourceId)).map(e=>e.event.id);if(item.disposition==='event'&&!eventIds.length||item.disposition!=='event'&&eventIds.length)throw Error('REVIEW_DISPOSITION_MISMATCH');return{...item,eventIds};}),changes};
}
function artifact(context){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kakao-cloud-'));fs.chmodSync(directory,0o700);const file=path.join(directory,'context.json');fs.writeFileSync(file,JSON.stringify(context),{mode:0o600});return file;}
async function main(){
  const configFile=process.env.KAKAO_CLOUD_CONFIG||path.resolve(__dirname,'../.local-data/supabase-publisher.json'),rpc=createRpc(JSON.parse(fs.readFileSync(configFile,'utf8'))),command=process.argv[2];
  if(command==='status'){console.log(JSON.stringify(await rpc('pm_history_sync_status')));return;}
  if(command==='collect'||command==='context'){
    const result=command==='collect'?await collect({rpc}):{},context=await rpc('pm_kakao_context');
    console.log(JSON.stringify({...result,revision:context.revision,pendingCount:context.pending.length,unresolvedCount:context.unresolved.length,contextFile:artifact(context)}));return;
  }
  if(command==='review'){
    const input=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),context=JSON.parse(fs.readFileSync(input.contextFile,'utf8')),review=buildReview(context,input);
    console.log(JSON.stringify(await rpc('pm_kakao_review',{p_review:review})));return;
  }throw Error('USE_COLLECT_CONTEXT_REVIEW_OR_STATUS');
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'KAKAO_CLOUD_FAILED');process.exitCode=1;});
module.exports={normalizeMessages,createRpc,collect,buildReview,ROOMS};
