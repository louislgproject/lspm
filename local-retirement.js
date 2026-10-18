'use strict';
// One-time private archive, never a routine ingestion or operational restore.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash,randomUUID}=require('node:crypto'),{gzipSync,gunzipSync}=require('node:zlib'),{execFileSync}=require('node:child_process');
const sha=x=>createHash('sha256').update(x).digest('hex');
function capture(file){
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file,{readOnly:true});
  try{db.exec('BEGIN');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('INVALID_RETIREMENT_DATABASE');const tables={};
    for(const {name}of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
      const id='"'+name.replaceAll('"','""')+'"',columns=db.prepare('PRAGMA table_info('+id+')').all().map(c=>c.name),rows=db.prepare('SELECT * FROM '+id+' ORDER BY rowid').all().map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Uint8Array?Buffer.from(v).toString('base64'):v])));tables[name]={columns,rows};
    }const revision=Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get().value);db.exec('COMMIT');return{format:'pm-retired-local-v1',revision,tables};
  }finally{db.close();}
}
async function archive(query,data,digest){
  if(data.format!=='pm-retired-local-v1'||!Number.isSafeInteger(data.revision)||!data.tables||!/^[a-f0-9]{64}$/.test(digest))throw Error('INVALID_RETIREMENT_ARCHIVE');
  const counts=Object.fromEntries(Object.entries(data.tables).map(([t,v])=>[t,v.rows.length])),tableHashes=Object.fromEntries(Object.entries(data.tables).map(([t,v])=>[t,createHash('md5').update(v.rows.map(r=>JSON.stringify(r)).join('\n')).digest('hex')])),manifest={purpose:'retired_local_archive',format:data.format,revision:data.revision,counts,tableHashes,blobEncoding:{sources:{content:'base64'}},rowsSha256:sha(JSON.stringify(data.tables))},total=Object.values(counts).reduce((n,v)=>n+v,0);
  const [publication]=await query('SELECT owner_id FROM pm.publication WHERE singleton=true');if(!publication)throw Error('NO_RETIREMENT_OWNER');
  await query("INSERT INTO pm.backup_recovery(id,backup_sha256,owner_id,revision,state,manifest) VALUES($1,$2,$3,$4,'staging',$5::jsonb) ON CONFLICT(backup_sha256) DO NOTHING",[randomUUID(),digest,publication.owner_id,data.revision,JSON.stringify(manifest)]);
  const [record]=await query('SELECT id,owner_id,state,manifest FROM pm.backup_recovery WHERE backup_sha256=$1',[digest]);if(record.owner_id!==publication.owner_id||record.manifest.rowsSha256!==manifest.rowsSha256)throw Error('RETIREMENT_OWNER_OR_CONTENT_CHANGED');
  if(record.state!=='committed'){
    let batch=[],bytes=0;const flush=async()=>{if(!batch.length)return;await query('INSERT INTO pm.backup_recovery_rows(recovery_id,table_name,row_index,row_text,row_hash) SELECT $1::uuid,x.table_name,x.row_index,x.row_text,x.row_hash FROM jsonb_to_recordset($2::jsonb) x(table_name text,row_index integer,row_text text,row_hash text) ON CONFLICT DO NOTHING',[record.id,JSON.stringify(batch)]);batch=[];bytes=0;};
    for(const [table,value]of Object.entries(data.tables))for(const [index,row]of value.rows.entries()){const text=JSON.stringify(row),item={table_name:table,row_index:index,row_text:text,row_hash:createHash('md5').update(text).digest('hex')},size=Buffer.byteLength(JSON.stringify(item));if(bytes+size>500000)await flush();batch.push(item);bytes+=size;}await flush();
  }
  const actual=await query("SELECT table_name,count(*)::integer n,count(*) FILTER(WHERE row_hash<>md5(row_text))::integer invalid,md5(string_agg(row_text,E'\\n' ORDER BY row_index)) AS digest FROM pm.backup_recovery_rows WHERE recovery_id=$1 GROUP BY table_name",[record.id]);
  for(const [table,n]of Object.entries(counts)){const found=actual.find(r=>r.table_name===table);if((found?.n||0)!==n||found?.invalid)throw Error('RETIREMENT_VERIFICATION_FAILED');if(n&&found.digest!==tableHashes[table])throw Error('RETIREMENT_CONTENT_MISMATCH');}
  if(actual.some(r=>!Object.hasOwn(counts,r.table_name))||actual.reduce((n,r)=>n+r.n,0)!==total)throw Error('RETIREMENT_ROW_COUNT_MISMATCH');
  await query("UPDATE pm.backup_recovery SET state='committed',committed_at=coalesce(committed_at,now()) WHERE id=$1 AND owner_id=$2",[record.id,publication.owner_id]);return{status:'archived',revision:data.revision,archivedRows:total,tableCounts:counts,operationalTablesUnchanged:true};
}
async function main(){
  process.umask(0o077);const command=process.argv[2],prefix=path.resolve(__dirname,'backups/local-retirement-20261018'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'pm-retire-'));
  try{
    if(command==='prepare'){
      const data=capture(path.resolve(__dirname,'../.local-data/ontology.sqlite')),bytes=gzipSync(JSON.stringify(data)),plain=path.join(temp,'retirement.json.gz'),key=path.resolve(__dirname,'../.local-data/lspm-github-db-backup.key');fs.writeFileSync(plain,bytes);
      execFileSync('openssl',['enc','-aes-256-cbc','-pbkdf2','-iter','200000','-in',plain,'-out',prefix+'.json.gz.enc','-pass','file:'+key],{stdio:'pipe'});
      const manifest={format:data.format,revision:data.revision,sha256:sha(bytes),encryptedSha256:sha(fs.readFileSync(prefix+'.json.gz.enc')),counts:Object.fromEntries(Object.entries(data.tables).map(([t,v])=>[t,v.rows.length]))};fs.writeFileSync(prefix+'.manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));return;
    }
    if(command!=='archive')throw Error('USE_PREPARE_OR_ARCHIVE');
    if(!process.env.LSPM_DB_BACKUP_KEY||!process.env.SUPABASE_ACCESS_TOKEN)throw Error('RETIREMENT_SECRETS_UNAVAILABLE');
    const manifest=JSON.parse(fs.readFileSync(prefix+'.manifest.json')),encrypted=fs.readFileSync(prefix+'.json.gz.enc');if(sha(encrypted)!==manifest.encryptedSha256)throw Error('RETIREMENT_ENCRYPTED_HASH_MISMATCH');
    const plain=path.join(temp,'retirement.json.gz');execFileSync('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-in',prefix+'.json.gz.enc','-out',plain,'-pass','env:LSPM_DB_BACKUP_KEY'],{stdio:'pipe'});const bytes=fs.readFileSync(plain);if(sha(bytes)!==manifest.sha256)throw Error('RETIREMENT_HASH_MISMATCH');
    const {createManagementApi}=require('./scripts/supabase-management'),api=createManagementApi({project:'ahzpuefosoajwwgbfhng',token:process.env.SUPABASE_ACCESS_TOKEN});
    const query=async(sql,parameters=[])=>{for(let n=0;;n++)try{return await api('/database/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:sql,parameters})});}catch(e){if(n>=3||!/could not connect|\((408|429|500|502|503|504)\)/.test(e.message))throw e;await new Promise(r=>setTimeout(r,1000*(n+1)));}};
    console.log(JSON.stringify(await archive(query,JSON.parse(gunzipSync(bytes)),manifest.sha256)));
  }finally{fs.rmSync(temp,{recursive:true});}
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'RETIREMENT_ARCHIVE_FAILED');process.exitCode=1;});
module.exports={capture,archive};
