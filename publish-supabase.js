'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {redact}=require('./firebase-transfer');
const hash=v=>createHash('sha256').update(typeof v==='string'||v instanceof Uint8Array?v:JSON.stringify(v)).digest('hex');
const configPath=path.resolve(__dirname,'../.local-data/supabase-publisher.json');
const cachePath=path.resolve(__dirname,'../.local-data/supabase-publish-state.json');
function changesFrom(db,cache={}){
  const rows=[];
  for(const table of ['sources','entities','relations','project_memberships'])for(const raw of db.prepare('SELECT * FROM '+table).all()){
    const row={...raw};
    if(table==='sources'){
      const original=Buffer.from(row.content),originalMetadata=row.metadata_json;let bytes=original;
      if(/^text\//.test(row.mime_type)||row.mime_type==='application/json'){
        try{const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(original);bytes=Buffer.from(redact(text));}catch{}
      }
      const cleanMetadata=redact(originalMetadata);
      if(!bytes.equals(original)||cleanMetadata!==originalMetadata){const metadata=JSON.parse(cleanMetadata);metadata.supabasePublication={redacted:true,originalContentSha256:hash(original),publishedContentSha256:hash(bytes),originalMetadataSha256:hash(originalMetadata)};row.metadata_json=JSON.stringify(metadata);}
      row.content=bytes.toString('base64');
    }
    const id=table==='project_memberships'?JSON.stringify([row.project_id,row.entity_id]):row.id,key=table+':'+id,fingerprint=hash(row);
    if(cache[key]?.hash===fingerprint)continue;
    rows.push({table,id,row,...(table==='entities'&&cache[key]?.row?{before:cache[key].row}:{}),fingerprint,key});
  }
  return rows;
}
async function publish({fetchImpl=fetch,configFile=configPath,stateFile=cachePath,dbFile=process.env.PM_DB_PATH||path.resolve(__dirname,'../.local-data/ontology.sqlite'),statusOnly=false}={}){
  if(!fs.existsSync(configFile))throw Error('SUPABASE_PUBLISHER_NOT_CONFIGURED');
  const config=JSON.parse(fs.readFileSync(configFile)),base='https://ahzpuefosoajwwgbfhng.supabase.co/rest/v1/rpc/';
  async function rpc(name,input){
    const r=await fetchImpl(base+name,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.token,...input}),signal:AbortSignal.timeout(60000)});
    if(!r.ok){
      const error=Error('SUPABASE_PUBLISH_FAILED_'+r.status);let detail;try{detail=await r.json();}catch{}
      // Only known PostgreSQL transaction rollbacks can retire an operation key.
      error.definitive=[400,409,422].includes(r.status)&&/^(22|23)[A-Z0-9]{3}$/.test(detail?.code||'');
      if(detail?.code==='P0001'&&/^(INVALID_PUBLISH_BATCH|INVALID_REQUEST_KEY|INVALID_PUBLISH_RECORD|SOURCE_ID_MISMATCH|ENTITY_ID_MISMATCH|INVALID_ENTITY_RECORD|RELATION_ID_MISMATCH|PUBLISH_TABLE_NOT_ALLOWED)$/.test(detail.message||''))error.definitive=true;
      throw error;
    }return r.json();
  }
  if(statusOnly)return rpc('pm_history_sync_status',{});
  const cache=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};
  const db=new DatabaseSync(dbFile,{readOnly:true});let snapshot;
  try{
    db.exec('BEGIN');
    const entities=db.prepare('SELECT data_json FROM entities').all().map(r=>JSON.parse(r.data_json));
    const relations=db.prepare('SELECT data_json,scope_project_id FROM relations').all().map(r=>({...JSON.parse(r.data_json),scopeProjectId:r.scope_project_id}));
    require('./ontology-model').validateStore({version:1,entities,relations});
    if(entities.some(e=>e.type==='Event'&&e.eventRecord&&e.privacy!=='local_only'))throw Error('PRIVATE_HISTORY_REQUIRED');
    snapshot=changesFrom(db,{});db.exec('COMMIT');
  }finally{db.close();}
  cache.records||={};let changed=0,conflicts=0,revision;let batch=[];
  function saveState(){const temp=stateFile+'.pending';fs.writeFileSync(temp,JSON.stringify(cache),{mode:0o600});fs.renameSync(temp,stateFile);}
  async function sendPending(){
    const pending=cache.pendingBatch;let result;
    try{result=await rpc('pm_ingest_local_history',{p_batch:{key:pending.requestKey,changes:pending.changes}});}catch(error){
      if(error.definitive){
        const file=stateFile+'.rejected-'+pending.requestKey+'.json';
        fs.writeFileSync(file,JSON.stringify(pending),{mode:0o600});
        cache.lastRejectedBatch={file,rejectedAt:new Date().toISOString()};delete cache.pendingBatch;saveState();
      }throw error;
    }
    const accepted=new Set(result.accepted.map(x=>x.table+':'+x.id)),rejected=new Set(result.conflicts.map(x=>x.table+':'+x.id));
    if(pending.items.some(x=>!accepted.has(x.key)&&!rejected.has(x.key)))throw Error('PUBLISH_ACK_INCOMPLETE');
    for(const item of pending.items)if(accepted.has(item.key))cache.records[item.key]={hash:item.fingerprint,...(item.table==='entities'?{row:item.row}:{})};
    changed+=result.changed;conflicts+=result.conflicts.length;revision=result.revision;cache.lastConfirmedAt=new Date().toISOString();cache.remoteRevision=revision;cache.pendingConflicts=conflicts;delete cache.pendingBatch;saveState();
  }
  const recoveredPending=Boolean(cache.pendingBatch);if(recoveredPending)await sendPending();
  const rows=snapshot.filter(r=>cache.records[r.key]?.hash!==r.fingerprint).map(r=>({...r,...(r.table==='entities'&&cache.records[r.key]?.row?{before:cache.records[r.key].row}:{})}));
  if(!rows.length){const remote=await rpc('pm_history_sync_status',{});return {unchanged:changed===0,changed,conflicts,revision:remote.revision,recoveredPending,pendingConflicts:cache.pendingConflicts||0};}
  async function flush(){
    if(!batch.length)return;const changes=batch.map(({table,id,row,before})=>({table,id,row,...(before?{before}:{})}));
    cache.pendingBatch={requestKey:hash({operation:randomUUID(),changes}),changes,items:batch};saveState();await sendPending();batch=[];
  }
  for(const row of rows){if(Buffer.byteLength(JSON.stringify(row.row))>380000)throw Error('PUBLISH_RECORD_REQUIRES_ATTACHMENT_TRANSFER');if(batch.length>=200||Buffer.byteLength(JSON.stringify(batch))+Buffer.byteLength(JSON.stringify(row))>390000)await flush();batch.push(row);}await flush();
  return {changed,conflicts,revision,recordsConsidered:rows.length};
}
if(require.main===module)publish({statusOnly:process.argv.includes('--status')}).then(result=>{console.log(JSON.stringify(result));if(result.conflicts)process.exitCode=2;}).catch(e=>{console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'SUPABASE_PUBLISH_FAILED');process.exitCode=1;});
module.exports={changesFrom,publish};
