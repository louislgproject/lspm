const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {changesFrom,publish}=require('./publish-supabase');

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-publisher-test-')),file=path.join(dir,'db.sqlite'),db=new DatabaseSync(file);
 db.exec("CREATE TABLE sources(id TEXT,kind TEXT,filename TEXT,mime_type TEXT,content BLOB,created_at TEXT,metadata_json TEXT);CREATE TABLE entities(id TEXT,type TEXT,data_json TEXT);CREATE TABLE relations(id TEXT,type TEXT,from_id TEXT,to_id TEXT,scope_project_id TEXT,data_json TEXT);CREATE TABLE project_memberships(project_id TEXT,entity_id TEXT)");
 db.prepare('INSERT INTO sources VALUES(?,?,?,?,?,?,?)').run('s','history','source','text/plain',Buffer.from('{"text":"LG Innotek request","cdrToken":"must-not-upload"}'),'2026-10-17','{}');
 db.prepare('INSERT INTO entities VALUES(?,?,?)').run('person','Person',JSON.stringify({id:'person',type:'Person',name:'Confirmed person',status:'active'}));
 return {dir,file,db};
}
test('publisher retains author text but excludes credentials and deduplicates confirmed rows',()=>{
 const f=fixture();const rows=changesFrom(f.db);assert.equal(rows.length,2);const s=rows.find(r=>r.table==='sources');const text=Buffer.from(s.row.content,'base64').toString();assert.ok(text.includes('LG Innotek request'));assert.ok(!text.includes('must-not-upload'));
 assert.equal(JSON.parse(s.row.metadata_json).supabasePublication.publishedContentSha256,require('node:crypto').createHash('sha256').update(text).digest('hex'));
 const cache=Object.fromEntries(rows.map(r=>[r.key,{hash:r.fingerprint,row:r.row}]));assert.deepEqual(changesFrom(f.db,cache),[]);f.db.close();
});
test('failed publication does not advance local checkpoint',async()=>{
 const f=fixture();f.db.close();const configFile=path.join(f.dir,'config.json'),stateFile=path.join(f.dir,'state.json');fs.writeFileSync(configFile,JSON.stringify({token:'private-token',publishableKey:'public'}));
 await assert.rejects(publish({configFile,stateFile,dbFile:f.file,fetchImpl:async()=>({ok:false,status:503})}),/SUPABASE_PUBLISH_FAILED_503/);const state=JSON.parse(fs.readFileSync(stateFile));assert.deepEqual(state.records,{});assert.equal(state.lastConfirmedAt,undefined);assert.equal(state.pendingBatch.requestKey.length,64);
});
test('binary source bytes and text byte-order marks survive publication',()=>{
 const f=fixture(),binary=Buffer.from('89504e47ff','hex'),bom=Buffer.from('\uFEFFRetain original text');
 f.db.prepare('INSERT INTO sources VALUES(?,?,?,?,?,?,?)').run('png','attachment','photo.png','image/png',binary,'2026-10-17','{}');
 f.db.prepare('INSERT INTO sources VALUES(?,?,?,?,?,?,?)').run('bom','history','text.txt','text/plain',bom,'2026-10-17','{}');
 const rows=changesFrom(f.db);assert.deepEqual(Buffer.from(rows.find(r=>r.id==='png').row.content,'base64'),binary);assert.deepEqual(Buffer.from(rows.find(r=>r.id==='bom').row.content,'base64'),bom);f.db.close();
});
test('new operations get new request keys even when an earlier value repeats',async()=>{
 const f=fixture();f.db.close();const configFile=path.join(f.dir,'config.json'),stateFile=path.join(f.dir,'state.json');fs.writeFileSync(configFile,JSON.stringify({token:'private-token',publishableKey:'public'}));
 const replies=new Map(),keys=[],remote={name:''};let revision=0;
 const fetchImpl=async(url,request)=>{if(url.endsWith('pm_history_sync_status'))return {ok:true,json:async()=>({revision})};const b=JSON.parse(request.body).p_batch;keys.push(b.key);if(!replies.has(b.key)){for(const c of b.changes)if(c.table==='entities')remote.name=JSON.parse(c.row.data_json).name;replies.set(b.key,{revision:++revision,changed:1,accepted:b.changes.map(c=>({table:c.table,id:c.id})),conflicts:[]});}return{ok:true,json:async()=>replies.get(b.key)};};
 for(const name of ['A','B','A','B']){const d=new DatabaseSync(f.file);d.prepare('UPDATE entities SET data_json=?').run(JSON.stringify({id:'person',type:'Person',name,status:'active'}));d.close();await publish({configFile,stateFile,dbFile:f.file,fetchImpl});}
 assert.equal(remote.name,'B');assert.equal(new Set(keys).size,4);
});
test('an uncertain request reuses its persisted operation key on retry',async()=>{
 const f=fixture();f.db.close();const configFile=path.join(f.dir,'config.json'),stateFile=path.join(f.dir,'state.json');fs.writeFileSync(configFile,JSON.stringify({token:'private-token',publishableKey:'public'}));
 const keys=[],replies=new Map();let loseReply=true;
 const fetchImpl=async(url,request)=>{if(url.endsWith('pm_history_sync_status'))return{ok:true,json:async()=>({revision:1})};const b=JSON.parse(request.body).p_batch;keys.push(b.key);if(!replies.has(b.key))replies.set(b.key,{revision:1,changed:1,accepted:b.changes.map(c=>({table:c.table,id:c.id})),conflicts:[]});if(loseReply){loseReply=false;throw Error('Connection lost after commit');}return{ok:true,json:async()=>replies.get(b.key)};};
 await assert.rejects(publish({configFile,stateFile,dbFile:f.file,fetchImpl}),/Connection lost/);await publish({configFile,stateFile,dbFile:f.file,fetchImpl});assert.equal(keys[0],keys[1]);assert.equal(replies.size,1);assert.equal(JSON.parse(fs.readFileSync(stateFile)).pendingBatch,undefined);
});
test('a definite transaction rejection is quarantined and does not block corrected input',async()=>{
 const f=fixture();f.db.close();const configFile=path.join(f.dir,'config.json'),stateFile=path.join(f.dir,'state.json');fs.writeFileSync(configFile,JSON.stringify({token:'private-token',publishableKey:'public'}));let rejected=true;const keys=[];
 const fetchImpl=async(_url,request)=>{const b=JSON.parse(request.body).p_batch;keys.push(b.key);if(rejected){rejected=false;return{ok:false,status:400,json:async()=>({code:'22P02',message:'Invalid JSON input'})};}return{ok:true,json:async()=>({revision:1,changed:1,accepted:b.changes.map(c=>({table:c.table,id:c.id})),conflicts:[]})};};
 await assert.rejects(publish({configFile,stateFile,dbFile:f.file,fetchImpl}),/SUPABASE_PUBLISH_FAILED_400/);const first=JSON.parse(fs.readFileSync(stateFile));assert.equal(first.pendingBatch,undefined);assert.equal(fs.existsSync(first.lastRejectedBatch.file),true);assert.deepEqual(first.records,{});
 const d=new DatabaseSync(f.file);d.prepare('UPDATE sources SET metadata_json=?').run('{"corrected":true}');d.close();await publish({configFile,stateFile,dbFile:f.file,fetchImpl});assert.notEqual(keys[0],keys[1]);
});
test('invalid ontology never reaches the remote publisher',async()=>{
 const f=fixture();f.db.prepare('UPDATE entities SET data_json=?').run(JSON.stringify({id:'person',type:'Person',name:'Broken person'}));f.db.close();
 const configFile=path.join(f.dir,'config.json'),stateFile=path.join(f.dir,'state.json');fs.writeFileSync(configFile,JSON.stringify({token:'private-token',publishableKey:'public'}));let called=false;
 await assert.rejects(publish({configFile,stateFile,dbFile:f.file,fetchImpl:async()=>{called=true;throw Error('Unexpected network call');}}),/Invalid or duplicate object/);assert.equal(called,false);assert.equal(fs.existsSync(stateFile),false);
});
test('successful publication checkpoints accepted rows only and retries conflicts',async()=>{
 const f=fixture();f.db.close();const configFile=path.join(f.dir,'config.json'),stateFile=path.join(f.dir,'state.json');fs.writeFileSync(configFile,JSON.stringify({token:'private-token',publishableKey:'public'}));
 const result=await publish({configFile,stateFile,dbFile:f.file,fetchImpl:async(_url,request)=>{const b=JSON.parse(request.body).p_batch;return {ok:true,json:async()=>({revision:12,changed:1,accepted:b.changes.filter(r=>r.table==='sources'),conflicts:[{table:'entities',id:'person'}]})};}});
 assert.equal(result.conflicts,1);const cache=JSON.parse(fs.readFileSync(stateFile));assert.ok(cache.records['sources:s']);assert.equal(cache.records['entities:person'],undefined);
 const db=new DatabaseSync(f.file,{readOnly:true});assert.equal(changesFrom(db,cache.records).length,1);db.close();
});
