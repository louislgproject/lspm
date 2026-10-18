'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const sha256=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function withVerifiedBackup({directory,key},operation){
  if(!key?.trim())throw Error('Add the original key file contents as the GitHub repository secret LSPM_DB_BACKUP_KEY. Do not paste the key into chat.');
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'ontology-2026-10-16.manifest.json'),'utf8'));
  if(manifest.format!=='pm-local-sqlite-encrypted-v1'||manifest.encryption?.cipher!=='aes-256-cbc'||manifest.encryption?.kdf!=='PBKDF2'||manifest.encryption?.iterations!==200000)throw Error('Unsupported encrypted backup format.');
  const encrypted=path.join(directory,'ontology-2026-10-16.sqlite.enc');
  if(sha256(encrypted)!==manifest.encryptedSha256)throw Error('Encrypted backup checksum does not match its manifest.');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lspm-backup-check-'));
  let db;
  try{
    const decrypted=path.join(temp,'ontology.sqlite');
    const result=spawnSync('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-in',encrypted,'-out',decrypted,'-pass','env:LSPM_DB_BACKUP_KEY'],{env:{...process.env,LSPM_DB_BACKUP_KEY:key.split(/\r?\n/)[0]},stdio:['ignore','ignore','pipe']});
    if(result.error||result.status!==0||!fs.existsSync(decrypted)||fs.readFileSync(decrypted).subarray(0,15).toString()!=='SQLite format 3')throw Error('Backup decryption failed. Verify that the repository secret contains the original key file contents.');
    fs.chmodSync(decrypted,0o600);
    if(sha256(decrypted)!==manifest.plaintextSha256)throw Error('Decrypted database checksum does not match its manifest.');
    db=new DatabaseSync(decrypted,{readOnly:true});
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw Error('SQLite integrity check failed.');
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite foreign-key check failed.');
    const revision=Number(db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value);
    if(revision!==manifest.databaseRevision)throw Error('Database revision differs from the backup manifest.');
    const tables={};
    for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
      const quoted='"'+name.replaceAll('"','""')+'"';
      tables[name]={count:db.prepare('SELECT count(*) AS count FROM '+quoted).get().count,columns:db.prepare('PRAGMA table_info('+quoted+')').all().map(c=>c.name)};
    }
    for(const [table,count] of Object.entries(manifest.counts))if(tables[table]?.count!==count)throw Error('Record count differs from the manifest for table '+table+'.');
    const report={revision,schemaVersion:Number(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value),integrity:'ok',encryptedChecksumVerified:true,plaintextChecksumVerified:true,tables};
    return operation(db,report);
  }finally{if(db)db.close();fs.rmSync(temp,{recursive:true,force:true});}
}
function inspectEncryptedBackup(options){return withVerifiedBackup(options,(_db,report)=>report);}

if(require.main===module){
  process.umask(0o077);
  try{
    const report=inspectEncryptedBackup({directory:process.argv[2],key:process.env.LSPM_DB_BACKUP_KEY});
    const output=process.argv[3];if(!output)throw Error('Specify a metadata report output path.');
    fs.writeFileSync(output,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
    console.log('Backup verified: revision '+report.revision+', '+report.tables.entities.count+' objects, '+report.tables.relations.count+' relations, '+report.tables.projects.count+' projects. No records imported.');
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n## Original database backup verified\n\nChecksums, SQLite integrity and foreign keys passed. No data has been imported into Supabase.\n\n| Table | Records |\n| --- | ---: |\n'+Object.entries(report.tables).map(([name,t])=>'| '+name+' | '+t.count+' |').join('\n')+'\n');
  }catch(error){
    console.error(error.message);
    const output=process.argv[3];
    if(output&&!fs.existsSync(output))fs.writeFileSync(output,JSON.stringify({status:'failed',diagnostic:error.message},null,2),{mode:0o600,flag:'wx'});
    process.exitCode=1;
  }
}
module.exports={inspectEncryptedBackup,withVerifiedBackup};
