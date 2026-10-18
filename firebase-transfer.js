'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const hash=value=>createHash('sha256').update(value).digest('hex');
const KEYS={projects:['id'],entities:['id'],relations:['id'],project_memberships:['project_id','entity_id'],project_assessments:['project_id','entity_id'],project_schedules:['project_id','entity_id'],project_workstreams:['project_id','entity_id','code'],project_view_settings:['project_id','view_key'],sources:['id'],ingestion_jobs:['id'],wip_snapshots:['id'],wip_counts:['id'],hourly_records:['id'],sample_preparation_records:['id']};
const COLUMNS={projects:['id','name','status','created_at','updated_at','project_type'],entities:['id','type','data_json'],relations:['id','type','from_id','to_id','scope_project_id','data_json'],project_memberships:['project_id','entity_id'],project_assessments:['project_id','entity_id','data_json'],project_schedules:['project_id','entity_id','data_json'],project_workstreams:['project_id','entity_id','code'],project_view_settings:['project_id','view_key','data_json'],sources:['id','kind','filename','mime_type','content','created_at','metadata_json'],ingestion_jobs:['id','source_id','status','draft_json','created_at','updated_at'],wip_snapshots:['id','project_id','captured_at','filename','sheet','created_at'],wip_counts:['id','snapshot_id','source_row','source_column','product_code','part_label','part_id','stage_label','step_id','quantity'],hourly_records:['id','project_id','data_json','recorded_at','revision'],sample_preparation_records:['id','project_id','sheet_id','version','data_json','recorded_at','revision']};

function redact(value){
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:cdrToken|access_token|refresh_token|password|passwordHash|client_secret|private_key|service_role_key|api_key)$/i.test(key)?(item&&typeof item==='object'&&'stringValue'in item?{stringValue:'[REDACTED]'}:'[REDACTED]'):redact(item)]));
  if(typeof value==='string'&&/^[\s]*[\[{]/.test(value)){
    try{const bom=value.startsWith('\uFEFF')?'\uFEFF':'',json=JSON.parse(value.slice(bom.length)),clean=redact(json);return JSON.stringify(json)===JSON.stringify(clean)?value:bom+JSON.stringify(clean);}catch{}
  }
  return value;
}
function decodeFields(fields){
  const decode=v=>{
    if('integerValue'in v){const n=Number(v.integerValue);return Number.isSafeInteger(n)?n:v.integerValue;}
    if('mapValue'in v)return decodeFields(v.mapValue.fields||{});
    if('arrayValue'in v)return(v.arrayValue.values||[]).map(decode);
    return Object.values(v)[0];
  };
  return Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,decode(v)]));
}
function mergeSQL({tables,snapshotHash,expectedRevision}){
  if(!/^[a-f0-9]{64}$/.test(snapshotHash)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||tables.some(t=>!KEYS[t]))throw Error('INVALID_MERGE_INPUT');
  let inserts='';
  for(const table of tables){
    const columns=COLUMNS[table],expressions=columns.map(c=>table==='sources'&&c==='content'?"decode(c.row_json->>'content','base64')":`(jsonb_populate_record(NULL::pm.${table},c.row_json))."${c}"`);
    const match=KEYS[table].map(k=>`t."${k}"=c.row_json->>'${k}'`).join(' AND ');
    const prior=table==='sources'?"(to_jsonb(t)-'owner_id'-'rowid'-'content')||jsonb_build_object('content',replace(encode(t.content,'base64'),E'\\n',''))":"to_jsonb(t)-'owner_id'-'rowid'";
    inserts+=`INSERT INTO pm.firebase_conflicts(snapshot_hash,table_name,key_json,existing_row,incoming_row)
      SELECT '${snapshotHash}','${table}',c.key_json,${prior},c.row_json FROM pm.firebase_candidates c JOIN pm.${table} t ON t.owner_id=target AND ${match}
      WHERE c.snapshot_hash='${snapshotHash}' AND c.table_name='${table}' AND (${prior})<>c.row_json ON CONFLICT DO NOTHING;
      INSERT INTO pm.${table}(owner_id,${columns.map(c=>'"'+c+'"').join(',')}) SELECT target,${expressions.join(',')} FROM pm.firebase_candidates c WHERE c.snapshot_hash='${snapshotHash}' AND c.table_name='${table}' ON CONFLICT DO NOTHING;\n`;
  }
  return `BEGIN; SET CONSTRAINTS ALL DEFERRED;
DO $transfer$ DECLARE target UUID; state TEXT; current_revision TEXT; BEGIN
  SELECT owner_id,status INTO target,state FROM pm.firebase_exports WHERE snapshot_hash='${snapshotHash}' FOR UPDATE;
  IF target IS NULL THEN RAISE EXCEPTION 'EXPORT_NOT_STAGED'; END IF;
  IF state='committed' THEN RETURN; END IF;
  PERFORM owner_id FROM pm.publication WHERE singleton=true AND owner_id=target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_CHANGED'; END IF;
  SELECT value INTO current_revision FROM pm.meta WHERE owner_id=target AND key='revision' FOR UPDATE;
  IF current_revision<>'${expectedRevision}' THEN RAISE EXCEPTION 'TARGET_REVISION_CHANGED'; END IF;
  ${inserts}
  UPDATE pm.meta SET value='${expectedRevision+1}' WHERE owner_id=target AND key='revision';
  UPDATE pm.firebase_exports SET status='committed',committed_at=now() WHERE snapshot_hash='${snapshotHash}';
END $transfer$; COMMIT;`;
}

async function exportFirestore(output){
  const {DatabaseSync}=require('node:sqlite'),auth=require('firebase-tools/lib/auth');
  const a=auth.selectAccount('delaserre1314@gmail.com',process.cwd()),token=await auth.getAccessToken(a.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  const root='https://firestore.googleapis.com/v1/projects/ontho-166a6/databases/(default)/documents';
  const headers={Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'};
  const initial=await fetch(root+'/privatePM/seed',{headers,signal:AbortSignal.timeout(30000)});
  if(!initial.ok)throw Error('FIREBASE_ACCESS_FAILED');
  const readTime=new Date(Date.parse(initial.headers.get('date'))-1000).toISOString();await initial.arrayBuffer();
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pm-firestore-export-')),file=path.join(temp,'firestore.sqlite'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE documents(path TEXT PRIMARY KEY,document_json TEXT NOT NULL);CREATE TABLE collections(path TEXT PRIMARY KEY,documents INTEGER NOT NULL);');
  let active=0;const waiters=[];
  async function call(url,options){
    if(active>=8)await new Promise(resolve=>waiters.push(resolve));active++;
    try{const r=await fetch(url,{headers,...options,signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('FIREBASE_READ_'+r.status);return await r.json();}finally{active--;waiters.shift()?.();}
  }
  let stored=0;
  async function walk(parent){
    let pageToken='';const names=[];
    do{const p=await call(root+(parent?'/'+parent:'')+':listCollectionIds',{method:'POST',body:JSON.stringify({pageSize:1000,readTime,...(pageToken?{pageToken}:{})})});names.push(...p.collectionIds||[]);pageToken=p.nextPageToken||'';}while(pageToken);
    await Promise.all(names.map(async name=>{
      const collection=(parent?parent+'/':'')+name,children=[];let next='',count=0;
      do{
        const q=new URLSearchParams({pageSize:'1000',showMissing:'true',readTime,...(next?{pageToken:next}:{})});
        const p=await call(root+'/'+collection+'?'+q);
        for(const doc of p.documents||[]){const key=doc.name.split('/documents/')[1];children.push(key);if(doc.fields){db.prepare('INSERT INTO documents VALUES(?,?)').run(key,JSON.stringify(redact(doc)));count++;stored++;}}
        next=p.nextPageToken||'';
      }while(next);
      db.prepare('INSERT INTO collections VALUES(?,?)').run(collection,count);
      // These are terminal collections in the deployed application's Firestore schema.
      if(!['chunks','scopes','events','uploads','workspace','ingestionJobs','projectCatalog','projectViews'].includes(name))await Promise.all(children.map(walk));
    }));
  }
  const timer=setInterval(()=>console.log(JSON.stringify({stage:'exporting-firestore',documents:stored})),30000);
  try{await walk('');}finally{clearInterval(timer);}
  const documents=db.prepare('SELECT * FROM documents ORDER BY path').all(),collections=db.prepare('SELECT * FROM collections ORDER BY path').all();db.close();
  const storage=[];
  for(const bucket of ['ontho-166a6.firebasestorage.app','ontho-166a6.appspot.com']){
    const r=await fetch('https://storage.googleapis.com/storage/v1/b/'+bucket+'/o?maxResults=1000',{headers,signal:AbortSignal.timeout(30000)});
    if(r.status!==404)throw Error('STORAGE_REQUIRES_OBJECT_EXPORT');
    storage.push({bucket,status:'bucket_not_found',objects:0});
  }
  const data={format:'pm-firebase-export-v1',readTime,firebaseProject:'ontho-166a6',documents,collections,storage,excluded:['Firebase Authentication credentials','Files outside Firebase']};
  const bytes=gzipSync(Buffer.from(JSON.stringify(data)),{level:9});fs.writeFileSync(output,bytes,{flag:'wx'});
  console.log(JSON.stringify({stage:'firebase-export-complete',documents:documents.length,collections:collections.length,bytes:bytes.length,sha256:hash(bytes),output}));
  return data;
}

async function prepareBundle(input,output){
  const {DatabaseSync}=require('node:sqlite'),P=require('./project-view'),Cloud=require('./cloud-domain');
  const data=JSON.parse(gunzipSync(fs.readFileSync(input))),docs=new Map(data.documents.map(d=>[d.path,decodeFields(JSON.parse(d.document_json).fields)]));
  const seed=docs.get('privatePM/seed'),version=seed.version;
  const chunks=[...docs].filter(([k])=>k.startsWith('privatePM/seed/versions/'+version+'/chunks/')).sort(([a],[b])=>a.localeCompare(b));
  const current=JSON.parse(chunks.map(([,v])=>v.text).join(''));
  if(chunks.length!==seed.chunkCount)throw Error('SEED_CHUNK_COUNT_MISMATCH');
  const views=new Map();for(const[k,v]of docs)if(/^projectViews\/[^/]+$/.test(k))views.set(k.split('/')[1],await P.decode(v.payload));
  const combined='backups/ontology-with-firebase.sqlite';fs.copyFileSync('backups/ontology-latest.sqlite',combined,fs.constants.COPYFILE_EXCL);
  const db=new DatabaseSync(combined),candidates=[],conflicts=[];db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
  function put(table,row){
    const keys=KEYS[table];if(!keys)throw Error('UNSUPPORTED_TABLE');
    const old=db.prepare('SELECT * FROM '+table+' WHERE '+keys.map(k=>k+'=?').join(' AND ')).get(...keys.map(k=>row[k]));
    if(old){if(JSON.stringify(old)!==JSON.stringify(row))conflicts.push({table,key:keys.map(k=>row[k])});return;}
    const names=Object.keys(row);if(names.some(k=>!COLUMNS[table].includes(k)))throw Error('UNSUPPORTED_COLUMN');
    db.prepare('INSERT INTO '+table+'('+names.join(',')+') VALUES('+names.map(()=>'?').join(',')+')').run(...names.map(k=>row[k]));
    candidates.push({table_name:table,key_json:Object.fromEntries(keys.map(k=>[k,row[k]])),row_json:Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Uint8Array?Buffer.from(v).toString('base64'):v]))});
  }
  const projects=new Map(current.workspace.projects.map(p=>[p.id,p]));for(const[id,v]of views)if(!projects.has(id))projects.set(id,v.project);
  for(const p of projects.values()){
    if(!db.prepare('SELECT id FROM projects WHERE id=?').get(p.id))put('projects',{id:p.id,name:p.name,status:p.status,created_at:p.createdAt||data.readTime,updated_at:p.updatedAt||data.readTime,project_type:p.projectType||null});
    for(const e of p.entities||[])if(!db.prepare('SELECT id FROM entities WHERE id=?').get(e.id))put('entities',{id:e.id,type:e.type,data_json:JSON.stringify(e)});
    for(const r of p.relations||[])if(!db.prepare('SELECT id FROM relations WHERE id=?').get(r.id))put('relations',{id:r.id,type:r.type,from_id:r.from,to_id:r.to,scope_project_id:r.scopeProjectId||null,data_json:JSON.stringify(r)});
    for(const e of p.entities||[])put('project_memberships',{project_id:p.id,entity_id:e.id});
    for(const[id,codes]of Object.entries(p.workstreams||{}))for(const code of codes)put('project_workstreams',{project_id:p.id,entity_id:id,code});
    const settings=views.get(p.id)?.settings||current.workspace.viewSettings?.[p.id]||{};
    for(const[view_key,value]of Object.entries(settings))if(!db.prepare('SELECT 1 FROM project_view_settings WHERE project_id=? AND view_key=?').get(p.id,view_key))put('project_view_settings',{project_id:p.id,view_key,data_json:JSON.stringify(value)});
  }
  const uploads=[...docs].filter(([k])=>/^privatePM\/records\/uploads\/[^/]+$/.test(k)).sort(([,a],[,b])=>a.createdAt.localeCompare(b.createdAt));
  for(const[docPath,envelope]of uploads){
    const payload=JSON.parse(envelope.payload),id=docPath.split('/').pop(),p=projects.get(current.workspace.projectAliases?.[payload.projectId]||payload.projectId);if(!p)throw Error('UPLOAD_PROJECT_MISSING');
    const time=envelope.createdAt;
    if(payload.kind==='sample-preparation'){
      const s=payload.sheet;put('sample_preparation_records',{id:'cloud-preparation-'+id,project_id:p.id,sheet_id:s.id,version:s.version,data_json:JSON.stringify(s),recorded_at:time,revision:payload.recordRevision});
    }else if(payload.kind==='hourly'){
      payload.rows.forEach((row,index)=>put('hourly_records',{id:'cloud-hourly-'+id+'-'+index,project_id:p.id,data_json:JSON.stringify({...row,sourceId:'cloud-hourly-source-'+id}),recorded_at:time,revision:payload.recordRevision}));
      put('sources',{id:'cloud-hourly-source-'+id,kind:'history',filename:'Firebase hourly report',mime_type:'text/plain',content:Buffer.from(payload.text||''),created_at:time,metadata_json:JSON.stringify({provider:'firebase-hourly',documentPath:docPath})});
    }else if(!payload.kind||payload.kind==='progress'){
      const log=Cloud.upload(p,{...payload,projectId:p.id},time,id);
      put('entities',{id:log.event.id,type:'Event',data_json:JSON.stringify({...log.event,status:'active'})});
      for(const r of log.links)put('relations',{id:r.id,type:r.type,from_id:r.from,to_id:r.to,scope_project_id:null,data_json:JSON.stringify(r)});
      put('sources',{id:'cloud-progress-source-'+id,kind:'history',filename:'Firebase Progress upload',mime_type:'text/plain',content:Buffer.from(log.text),created_at:time,metadata_json:JSON.stringify({provider:'firebase-progress',documentPath:docPath,eventId:log.event.id})});
      for(const unit of new Set(log.rows.map(r=>r.unit))){const r=log.rows.find(r=>r.unit===unit);put('wip_snapshots',{id:r.snapshotId,project_id:p.id,captured_at:time,filename:'Firebase Progress upload',sheet:'Progress · '+unit,created_at:time});}
      log.rows.forEach((r,i)=>put('wip_counts',{id:'cloud-wip-count-'+id+'-'+i,snapshot_id:r.snapshotId,source_row:r.row,source_column:r.column,product_code:r.code,part_label:p.entities.find(e=>e.id===r.partId)?.name||'',part_id:r.partId,stage_label:p.entities.find(e=>e.id===r.stepId)?.name||'',step_id:r.stepId,quantity:r.quantity}));
    }else throw Error('UNSUPPORTED_UPLOAD_KIND');
  }
  // Retain legacy attachment bytes even when their old project is no longer the active workspace.
  let attachments=0;
  for(const[docPath,source]of docs)if(/^users\/[^/]+\/projects\/[^/]+\/sources\/[^/]+$/.test(docPath)&&source.storage==='firestore_chunks'){
    const parts=[...docs].filter(([key])=>key.startsWith(docPath+'/chunks/')).sort(([a],[b])=>a.localeCompare(b));
    if(parts.length!==source.chunkCount)throw Error('ATTACHMENT_CHUNK_COUNT_MISMATCH');
    const bytes=Buffer.from(parts.map(([,v])=>v.data).join(''),'base64');if(bytes.length!==source.size)throw Error('ATTACHMENT_SIZE_MISMATCH');
    put('sources',{id:source.sourceId,kind:'firebase-attachment',filename:source.filename,mime_type:source.mimeType,content:bytes,created_at:source.uploadedAt,metadata_json:JSON.stringify({provider:'firebase-legacy',documentPath:docPath,projectId:source.projectId})});attachments++;
  }
  const revision=Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(revision+1));db.exec('COMMIT');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('COMBINED_DATABASE_INVALID');
  const counts=Object.fromEntries(Object.keys(KEYS).map(t=>[t,db.prepare('SELECT count(*) n FROM '+t).get().n]));db.close();
  data.candidates=candidates;data.summary={localRevision:revision,combinedRevision:revision+1,seedVersion:version,retainedDocuments:data.documents.length,seedHistoryRecords:Object.keys(current.eventDetails||{}).length,seedVersions:data.collections.filter(c=>/^privatePM\/seed\/versions\/[^/]+\/chunks$/.test(c.path)).length,cloudUploads:uploads.length,legacyAttachments:attachments,candidateRows:candidates.length,candidatesByTable:candidates.reduce((o,c)=>(o[c.table_name]=(o[c.table_name]||0)+1,o),{}),preservedLocalConflicts:conflicts.length,combinedCounts:counts};
  const bytes=gzipSync(Buffer.from(JSON.stringify(data)),{level:9});fs.writeFileSync(output,bytes,{flag:'wx'});
  const manifest={format:data.format,readTime:data.readTime,firebaseProject:data.firebaseProject,sha256:hash(bytes),bytes:bytes.length,combinedDatabaseSha256:hash(fs.readFileSync(combined)),...data.summary,storage:data.storage,excluded:data.excluded};
  fs.writeFileSync('backups/firebase-latest.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(manifest));return data;
}

async function importSupabase(input){
  let bytes;
  if(input.endsWith('.enc')){
    if(!process.env.LSPM_DB_BACKUP_KEY)throw Error('MISSING_BACKUP_KEY');
    const {spawnSync}=require('node:child_process'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'pm-firebase-decrypt-')),file=path.join(temp,'export.json.gz');
    try{const result=spawnSync('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-in',input,'-out',file,'-pass','env:LSPM_DB_BACKUP_KEY'],{stdio:['ignore','ignore','pipe']});if(result.status!==0)throw Error('BACKUP_DECRYPT_FAILED');bytes=fs.readFileSync(file);}finally{fs.rmSync(temp,{recursive:true,force:true});}
  }else bytes=fs.readFileSync(input);
  const manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(input),'firebase-latest.manifest.json')));
  if(hash(bytes)!==manifest.sha256)throw Error('BACKUP_HASH_MISMATCH');
  const data=JSON.parse(gunzipSync(bytes)),{createManagementApi}=require('./scripts/supabase-management');
  const token=process.env.SUPABASE_ACCESS_TOKEN;if(!token)throw Error('MISSING_SUPABASE_ACCESS_TOKEN');
  const api=createManagementApi({project:'ahzpuefosoajwwgbfhng',token,fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(60000)})});
  async function query(sql,parameters=[]){
    for(let attempt=0;;attempt++)try{return await api('/database/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:sql,...(parameters.length?{parameters}:{})})});}catch(error){if(attempt>=5||!/could not connect|\((408|429|500|502|503|504)\)/.test(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(5000,1000*(attempt+1))));}
  }
  const {applyMigrations}=require('./scripts/supabase-migrations');await applyMigrations(query,path.join(__dirname,'supabase/migrations'));
  const [target]=await query("SELECT p.owner_id,m.value::integer revision FROM pm.publication p JOIN pm.meta m ON m.owner_id=p.owner_id AND m.key='revision' WHERE p.singleton=true");
  if(!target)throw Error('TARGET_WORKSPACE_MISSING');
  await query("INSERT INTO pm.firebase_exports(snapshot_hash,owner_id,status,manifest) VALUES($1,$2,'staging',$3::jsonb) ON CONFLICT DO NOTHING",[manifest.sha256,target.owner_id,JSON.stringify(manifest)]);
  const[prior]=await query('SELECT status FROM pm.firebase_exports WHERE snapshot_hash=$1',[manifest.sha256]);
  if(prior.status==='committed'){
    const[verified]=await query("SELECT count(*)::integer documents,count(*) FILTER(WHERE encode(extensions.digest(document_json,'sha256'),'hex')<>sha256)::integer invalid_hashes FROM pm.firebase_documents WHERE snapshot_hash=$1",[manifest.sha256]);
    if(verified.documents!==data.documents.length||verified.invalid_hashes)throw Error('ARCHIVE_VERIFICATION_FAILED');
    console.log(JSON.stringify({status:'already_imported',snapshotHash:manifest.sha256,...verified}));return;
  }
  async function stage(rows,table,columns){
    let batch=[],size=0,done=0;const batches=[];
    for(const row of rows){const n=Buffer.byteLength(JSON.stringify(row));if(size+n>600000&&batch.length){batches.push(batch);batch=[];size=0;}batch.push(row);size+=n;}if(batch.length)batches.push(batch);
    const definition=columns.map(([k,t])=>k+' '+t).join(',');
    await require('./scripts/stage-batches').stageBatches(batches,group=>query(`INSERT INTO pm.${table}(snapshot_hash,${columns.map(([k])=>k).join(',')}) SELECT $1,x.* FROM jsonb_to_recordset($2::jsonb) AS x(${definition}) ON CONFLICT DO NOTHING`,[manifest.sha256,JSON.stringify(group)]),{onConfirmed:group=>{done+=group.length;console.log(JSON.stringify({stage:table,confirmed:done,total:rows.length}));}});
  }
  const present=new Map((await query('SELECT path,sha256 FROM pm.firebase_documents WHERE snapshot_hash=$1',[manifest.sha256])).map(d=>[d.path,d.sha256]));
  const documents=data.documents.map(d=>({path:d.path,document_json:d.document_json,sha256:hash(d.document_json)}));
  if(documents.some(d=>present.has(d.path)&&present.get(d.path)!==d.sha256))throw Error('STAGED_DOCUMENT_CHANGED');
  console.log(JSON.stringify({stage:'resume',alreadyArchived:present.size,remaining:documents.length-present.size}));
  await stage(documents.filter(d=>!present.has(d.path)),'firebase_documents',[['path','text'],['document_json','text'],['sha256','text']]);
  await stage(data.candidates,'firebase_candidates',[['table_name','text'],['key_json','jsonb'],['row_json','jsonb']]);
  const[staged]=await query("SELECT (SELECT count(*)::integer FROM pm.firebase_documents WHERE snapshot_hash=$1) documents,(SELECT count(*)::integer FROM pm.firebase_candidates WHERE snapshot_hash=$1) candidates,(SELECT count(*)::integer FROM pm.firebase_documents WHERE snapshot_hash=$1 AND encode(extensions.digest(document_json,'sha256'),'hex')<>sha256) invalid_hashes",[manifest.sha256]);
  if(staged.documents!==data.documents.length||staged.candidates!==data.candidates.length||staged.invalid_hashes)throw Error('STAGING_COUNT_MISMATCH');
  await query(mergeSQL({tables:Object.keys(KEYS).filter(t=>data.candidates.some(c=>c.table_name===t)),snapshotHash:manifest.sha256,expectedRevision:target.revision}));
  const[result]=await query("SELECT e.status,(SELECT count(*)::integer FROM pm.firebase_documents WHERE snapshot_hash=e.snapshot_hash) documents,(SELECT count(*)::integer FROM pm.firebase_candidates WHERE snapshot_hash=e.snapshot_hash) candidates,(SELECT count(*)::integer FROM pm.firebase_conflicts WHERE snapshot_hash=e.snapshot_hash) preserved_conflicts,(SELECT count(*)::integer FROM pm.projects WHERE owner_id=e.owner_id) projects,(SELECT count(*)::integer FROM pm.entities WHERE owner_id=e.owner_id) objects,(SELECT count(*)::integer FROM pm.wip_snapshots WHERE owner_id=e.owner_id) progress_snapshots,(SELECT count(*)::integer FROM pm.wip_counts c JOIN pm.wip_snapshots s ON s.owner_id=c.owner_id AND s.id=c.snapshot_id WHERE c.owner_id=e.owner_id) progress_counts,(SELECT count(*)::integer FROM pm.sample_preparation_records WHERE owner_id=e.owner_id) preparation_records FROM pm.firebase_exports e WHERE snapshot_hash=$1",[manifest.sha256]);
  if(result.status!=='committed'||result.documents!==data.documents.length)throw Error('IMPORT_VERIFICATION_FAILED');
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\nFirebase transfer verified. '+JSON.stringify(result)+'\n');
}
async function registerPublisher(tokenHash){
  if(!/^[a-f0-9]{64}$/.test(tokenHash||''))throw Error('INVALID_PUBLISHER_HASH');
  const {createManagementApi}=require('./scripts/supabase-management'),token=process.env.SUPABASE_ACCESS_TOKEN;if(!token)throw Error('MISSING_SUPABASE_ACCESS_TOKEN');
  const api=createManagementApi({project:'ahzpuefosoajwwgbfhng',token});
  await api('/database/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:"INSERT INTO pm.publisher_devices(token_hash,owner_id,name) SELECT $1,owner_id,'Local PM Kakao publisher' FROM pm.publication WHERE singleton=true ON CONFLICT DO NOTHING",parameters:[tokenHash]})});
  const rows=await api('/database/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'SELECT d.enabled FROM pm.publisher_devices d JOIN pm.publication p ON p.owner_id=d.owner_id AND p.singleton=true WHERE d.token_hash=$1',parameters:[tokenHash],read_only:true})});
  if(rows.length!==1||!rows[0].enabled)throw Error('PUBLISHER_REGISTRATION_FAILED');
  console.log(JSON.stringify({publisherRegistered:true,rawCredentialUploaded:false}));
}
if(require.main===module){const [mode,input,output]=process.argv.slice(2);Promise.resolve().then(()=>mode==='export'?exportFirestore(input):mode==='prepare'?prepareBundle(input,output):mode==='import'?importSupabase(input):mode==='register-publisher'?registerPublisher(input):Promise.reject(Error('Use export, prepare, import, or register-publisher'))).catch(e=>{console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'FIREBASE_TRANSFER_FAILED');process.exitCode=1;});}
module.exports={redact,decodeFields,mergeSQL,exportFirestore,prepareBundle,importSupabase};
