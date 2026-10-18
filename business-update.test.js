'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {compile,record,syncPending}=require('./scripts/record-business-update');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
function sample(){return {schemaVersion:1,recordedAt:'2026-10-18T01:00:00Z',source:{filename:'Production note',text:'Sample material arrival is planned for tomorrow.',origin:{threadId:'business-conversation',messageId:'message-1'}},events:[{key:'material-arrival',area:'development',title:'Sample material arrival planned',summary:'Arrival is planned; receipt has not been confirmed.',sourceExcerpt:'arrival is planned for tomorrow',projectIds:['project-test'],subjectIds:['part-test'],record:{kind:'progress',statementMode:'planned',verification:'reported',lifecycle:'active',timePrecision:'unknown',importance:'normal',reportedAt:'2026-10-18T00:55:00Z'}}]};}
const workspace={projects:[{id:'project-test',status:'active'}],entities:[{id:'part-test',type:'Part',name:'Confirmed Part'}]};
test('business intake retains evidence, distinguishes a plan and has stable replay IDs',()=>{
 const input=sample(),a=compile(input,workspace),b=compile(JSON.parse(JSON.stringify(input)),workspace);
 assert.deepEqual(a,b);const event=JSON.parse(a.changes.find(c=>c.table==='entities'&&c.row.type==='Event').row.data_json);
 const reordered=sample();reordered.source.origin=Object.fromEntries(Object.entries(reordered.source.origin).reverse());reordered.events[0].record=Object.fromEntries(Object.entries(reordered.events[0].record).reverse());assert.deepEqual(compile(reordered,workspace),a);
 assert.equal(event.eventRecord.statementMode,'planned');assert.equal(event.eventRecord.verification,'reported');assert.equal(event.eventRecord.occurredAt,undefined);
 assert.equal(event.eventRecord.scope.projectIds[0],'project-test');assert.equal(Buffer.from(a.changes[0].row.content,'base64').toString(),input.source.text);
 assert.ok(a.changes.some(c=>c.table==='relations'&&c.row.type==='supported_by'));
 assert.ok(a.changes.some(c=>c.table==='project_memberships'&&c.row.entity_id===event.id));
});
test('intake rejects software categories, unsupported subjects, duplicate keys and invented excerpts',()=>{
 for(const change of [s=>s.events[0].area='software',s=>s.events[0].subjectIds=['unknown'],s=>s.events.push({...s.events[0]}),s=>s.events[0].sourceExcerpt='Production completed',s=>s.recordedAt='today']){
  const input=sample();change(input);assert.throws(()=>compile(input,workspace));
 }
});
test('a sourced input can retain attachment bytes and extraction location',()=>{
 const input=sample();input.source.base64=Buffer.from([0x25,0x50,0x44,0x46,0xff]).toString('base64');input.source.mimeType='application/pdf';input.source.origin.page=3;
 const row=compile(input,workspace).changes[0].row;assert.equal(row.content,input.source.base64);assert.equal(JSON.parse(row.metadata_json).origin.page,3);assert.equal(JSON.parse(row.metadata_json).extractedText,input.source.text);
});

test('real PostgreSQL ingestion is atomic, repeatable, scoped and readable by the existing History API',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {Client}=require('pg'),{applyMigrations}=require('./scripts/supabase-migrations'),{withPostgresStore}=require('./postgres-store');
 const admin=new Client({connectionString:process.env.TEST_DATABASE_URL});await admin.connect();
 const name='business_intake_'+randomUUID().replaceAll('-','');let db;
 try{
  await admin.query('CREATE DATABASE '+name);const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+name;db=new Client({connectionString:url.toString()});await db.connect();
  await db.query("CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE TABLE auth.users(id UUID PRIMARY KEY)");
  await applyMigrations(async sql=>(await db.query(sql)).rows,path.join(__dirname,'supabase/migrations'),()=>{});
  const owner=(await db.query('SELECT owner_id FROM pm.publication')).rows[0].owner_id;
  await withPostgresStore(db,owner,async s=>{let w=await s.load();w.projects.push({id:'project-test',name:'Test production project',status:'active',createdAt:'2026-10-18T01:00:00Z',version:2,entities:[],relations:[]});w=await s.save(w,null,w.revision);w.library.entities.push({id:'part-test',type:'Part',name:'Confirmed Part',status:'active',projectId:'library'});await s.save(w,'library',w.revision);});
  const query=async sql=>(await db.query(sql)).rows,input=sample();
  assert.equal((await record(input,{query})).dryRun,true);
  const first=await record(input,{query,apply:true}),second=await record(input,{query,apply:true});assert.equal(first.verified,true);assert.equal(second.revision,first.revision);assert.equal(second.verified,true);
  const history=await withPostgresStore(db,owner,s=>s.historyList({scope:'project-test'}));assert.equal(history.totalDistinct,1);assert.equal(history.items[0].record.statementMode,'planned');
  const detail=await withPostgresStore(db,owner,s=>s.historyDetail(history.items[0].id,'project-test'));assert.equal(detail.sources[0].text,input.source.text);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pm.publisher_devices')).rows[0].n,0);
  const conflicting=sample();conflicting.events[0].summary='A conflicting rewrite';await assert.rejects(record(conflicting,{query,apply:true}),/BUSINESS_UPDATE_CONFLICT/);
  const after=await withPostgresStore(db,owner,s=>s.historyList({scope:'project-test'}));assert.equal(after.items[0].summary,input.events[0].summary);assert.equal((await db.query('SELECT count(*)::int AS n FROM pm.publisher_devices')).rows[0].n,0);
  const queued=await record(input,{query,enqueue:true});assert.equal(queued.queued,true);
  assert.equal((await record(input,{query,enqueue:true})).id,queued.id);
  const brokenAck=async sql=>{if(sql.startsWith('WITH acknowledged'))throw Error('Simulated lost acknowledgment');return query(sql);};
  await assert.rejects(syncPending({query:brokenAck}),/lost acknowledgment/);
  const synced=await syncPending({query});assert.equal(synced.batches,1);assert.equal(synced.verified,true);
  assert.equal((await record(input,{query,enqueue:true})).queued,false);
  assert.equal((await syncPending({query})).batches,0);
  assert.equal((await withPostgresStore(db,owner,s=>s.historyList({scope:'project-test'}))).totalDistinct,1);
 }finally{if(db)await db.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');await admin.end();}
});
