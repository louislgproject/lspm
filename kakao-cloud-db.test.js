'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const sha=value=>createHash('sha256').update(value).digest('hex');
const migration='supabase/migrations/202610180005_kakao_cloud.sql';
const chats=['453981707667079','461913194057523','473535309242980','481868546664117'];

// The development checkout can predate these dependencies. CI uses its checked-out files.
function dependency(file){
  if(process.env.CI)return fs.readFileSync(path.join(__dirname,file),'utf8');
  return execFileSync('git',['show','origin/main:'+file],{cwd:__dirname,encoding:'utf8'});
}

test('Kakao cloud RPCs against a disposable PostgreSQL database',{skip:!process.env.TEST_DATABASE_URL},async t=>{
  const {Client}=require('pg');
  const admin=new Client({connectionString:process.env.TEST_DATABASE_URL});
  await admin.connect();
  const database='kakao_cloud_'+randomUUID().replaceAll('-','');
  let db;
  try{
    await admin.query('CREATE DATABASE '+database);
    const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+database;
    db=new Client({connectionString:url.toString()});await db.connect();
    // Same minimal application fixtures as firebase-transfer.test.js; no live workspace writes.
    await db.query("CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql AS $$SELECT NULL::uuid$$;CREATE SCHEMA pm;REVOKE ALL ON SCHEMA pm FROM PUBLIC;CREATE TABLE pm.projects(owner_id UUID NOT NULL,id TEXT NOT NULL,name TEXT,status TEXT,created_at TEXT,updated_at TEXT,project_type TEXT,PRIMARY KEY(owner_id,id));CREATE TABLE pm.meta(owner_id UUID,key TEXT,value TEXT,PRIMARY KEY(owner_id,key));CREATE TABLE pm.publication(singleton BOOLEAN,owner_id UUID)");
    for(const role of ['anon','authenticated'])if(!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)await db.query('CREATE ROLE '+role);
    await db.query(dependency('supabase/migrations/202610170005_firebase_transfer.sql'));
    await db.query('CREATE TABLE pm.entities(owner_id UUID,id TEXT,type TEXT,data_json TEXT,PRIMARY KEY(owner_id,id));CREATE TABLE pm.sources(owner_id UUID,id TEXT,kind TEXT,filename TEXT,mime_type TEXT,content BYTEA,created_at TEXT,metadata_json TEXT,PRIMARY KEY(owner_id,id));CREATE TABLE pm.relations(owner_id UUID,id TEXT,type TEXT,from_id TEXT,to_id TEXT,scope_project_id TEXT,data_json TEXT,PRIMARY KEY(owner_id,id));CREATE TABLE pm.project_memberships(owner_id UUID,project_id TEXT,entity_id TEXT,PRIMARY KEY(owner_id,project_id,entity_id))');
    for(const file of ['202610170006_history_publisher.sql','202610170007_publisher_integrity.sql','202610170008_publisher_validation.sql'])await db.query(dependency('supabase/migrations/'+file));
    const owner=randomUUID(),other=randomUUID(),token='synthetic-kakao-test-'.padEnd(64,'x'),otherToken='other-owner-test-'.padEnd(64,'x');
    await db.query('INSERT INTO pm.publication VALUES(true,$1)',[owner]);
    await db.query("INSERT INTO pm.meta VALUES($1,'revision','338'),($2,'revision','1')",[owner,other]);
    for(const [cap,id]of [[token,owner],[otherToken,other]])await db.query("INSERT INTO pm.publisher_devices(token_hash,owner_id,name) VALUES($1,$2,'synthetic fixture')",[sha(cap),id]);
    await db.query("INSERT INTO pm.projects VALUES($1,'active','Live project','active','','','sample'),($1,'archived','Old project','archived','','','sample'),($2,'foreign','Other project','active','','','sample')",[owner,other]);
    const message=(log='3953216721672443340',extra={})=>({chatId:chats[0],logId:log,authorId:'3389141',sender:'Fixture sender',senderNameCandidates:['Fixture sender','Alternate name'],time:'2026-10-18T09:00:00-06:00',type:1,text:'Reported shipment delay',originalHash:sha('Reported shipment delay'),...extra});
    async function source(id,log,extra={},text='old original',sourceOwner=owner){
      const metadata={provider:'kakao',account:'local-kakao',roomId:chats[0],externalId:log,sourceKey:'kakao|local-kakao|'+chats[0]+'|'+log,senderId:'3389141',senderName:'Fixture sender',senderNameCandidates:['Fixture sender'],sentAt:'2026-10-18T09:00:00-06:00',sourceType:1,scope:'library',privacy:'local_only',hash:sha(text),processingState:'pending_review',...extra};
      await db.query("INSERT INTO pm.sources VALUES($1,$2,'history','fixture.txt','text/plain',$3,'2026-10-18',$4)",[sourceOwner,id,Buffer.from(text),JSON.stringify(metadata)]);return metadata;
    }
    await source('old-event','100',{processingState:'event_saved',reviewedAt:'2026-10-18T16:00:00Z',eventIds:['historical-event']});
    await source('old-only','101',{processingState:'source_only_saved',reviewedAt:'2026-10-18T16:00:00Z',eventIds:[]});
    await source('old-unresolved','102',{processingState:'pending_review',reviewedAt:'2026-10-18T16:00:00Z',reviewDisposition:{action:'unresolved',reason:'Unknown identity'},eventIds:[]});
    await source('old-unknown','103',{processingState:'future_status'});
    await source('old-reviewed-unknown','104',{processingState:'future_status',reviewedAt:'2026-10-18T16:00:00Z'});
    const original='{"cdrToken":"fixture-secret","text":"call"}',clean='{"cdrToken":"[REDACTED]","text":"call"}';
    await source('old-redacted','105',{sourceType:51,hash:sha(clean),supabasePublication:{originalContentSha256:sha(original),publishedContentSha256:sha(clean)}},clean);
    await source('old-digest','106',{hash:null},'digest original');
    await source('unapproved','9999',{roomId:'123',sourceKey:'kakao|local-kakao|123|9999'});
    await source('foreign-source','8888',{},'foreign original',other);
    async function putEntity(data,entityOwner=owner){await db.query('INSERT INTO pm.entities VALUES($1,$2,$3,$4)',[entityOwner,data.id,data.type,JSON.stringify(data)]);}
    await putEntity({id:'part',type:'Part',name:'Cloud-edited part',status:'active',quantity:42,rawLog:'private raw',sourceExcerpt:'private excerpt',custom:{keep:true}});
    await putEntity({id:'old-person',type:'Person',name:'Existing contact',status:'active',privacy:'local_only'});
    await putEntity({id:'foreign-person',type:'Person',name:'Other owner',status:'active'},other);
    await db.query("INSERT INTO pm.relations VALUES($1,'old-link','records_on','old-event','part',NULL,$2)",[owner,JSON.stringify({id:'old-link',type:'records_on',from:'old-event',to:'part',sourceExcerpt:'hidden',custom:'keep'})]);
    await db.query(fs.readFileSync(path.join(__dirname,migration),'utf8'));
    async function rpc(name,payload,cap=token){
      const params=[cap];if(name!=='context')params.push(JSON.stringify(payload));
      return (await db.query('SELECT public.pm_kakao_'+name+'('+params.map((_,i)=>'$'+(i+1)).join(',')+') value',params)).rows[0].value;
    }
    const context=()=>rpc('context');
    async function collect(m=message()){return rpc('collect',Array.isArray(m)?m:[m]);}
    async function pending(m=message()){await collect(m);return (await context()).pending.find(s=>s.metadata.externalId===m.logId);}
    const review=(sourceId,extra={})=>({key:sha('review '+sourceId),items:[{sourceId,disposition:'source_only',reason:'Acknowledgement only',eventIds:[]}],changes:[],...extra});
    function eventReview(sourceId,extra={}){
      const event={id:'new-event',type:'Event',name:'Shipment delay reported',status:'active',privacy:'local_only',eventRecord:{schemaVersion:1,recordClass:'business',kind:'disruption',statementMode:'reported_fact',verification:'reported',lifecycle:'active',importance:'attention',timePrecision:'exact',reportedAt:'2026-10-18T09:00:00-06:00',recordedAt:'2026-10-18T16:00:00Z',timezone:'America/Mexico_City',scope:{kind:'explicit_projects',projectIds:['active']}}};
      const evidence={id:'new-evidence',type:'Evidence',name:'Retained Kakao original',status:'active',privacy:'local_only',historySource:true,sourceId};
      const entity=data=>({table:'entities',id:data.id,row:{id:data.id,type:data.type,data_json:JSON.stringify(data)}});
      const relation=(id,type,to)=>({table:'relations',id,row:{id,type,from_id:event.id,to_id:to,scope_project_id:null,data_json:JSON.stringify({id,type,from:event.id,to,scopeProjectId:null})}});
      return review(sourceId,{items:[{sourceId,disposition:'event',reason:'Reported business disruption',eventIds:[event.id]}],changes:[entity(event),entity(evidence),relation('new-proof','supported_by',evidence.id),relation('new-subject','records_on','part')],...extra});
    }
    async function isolated(name,fn){await t.test(name,async()=>{await db.query('BEGIN');try{await fn();}finally{await db.query('ROLLBACK');}});}
    async function rejectReview(payload,pattern=/KAKAO_|INVALID_|NOT_ALLOWED/){await assert.rejects(rpc('review',payload),pattern);}
    // Rejected statements need a savepoint because each test is already in a transaction.
    const originalQuery=db.query.bind(db);
    db.query=async(...args)=>{
      const sql=typeof args[0]==='string'?args[0]:'';
      if(!sql.startsWith('SELECT public.pm_kakao_'))return originalQuery(...args);
      await originalQuery('SAVEPOINT rpc_attempt');
      try{const result=await originalQuery(...args);await originalQuery('RELEASE SAVEPOINT rpc_attempt');return result;}
      catch(error){await originalQuery('ROLLBACK TO SAVEPOINT rpc_attempt');await originalQuery('RELEASE SAVEPOINT rpc_attempt');throw error;}
    };

    await isolated('capability authentication, pinned owner, revoked tables/helpers',async()=>{
      for(const cap of [null,'wrong',otherToken])for(const name of ['context','collect','review'])await assert.rejects(rpc(name,name==='collect'?[]:review('old-unknown'),cap),/PUBLISHER_AUTH_REQUIRED/);
      await db.query('UPDATE pm.publisher_devices SET enabled=false WHERE token_hash=$1',[sha(token)]);await assert.rejects(context(),/PUBLISHER_AUTH_REQUIRED/);
      await db.query('UPDATE pm.publisher_devices SET enabled=true WHERE token_hash=$1',[sha(token)]);
      for(const role of ['anon','authenticated']){
        await db.query('SET LOCAL ROLE '+role);
        assert.equal((await context()).revision,338);
        for(const table of ['kakao_messages','kakao_reviews'])assert.equal((await db.query("SELECT has_table_privilege(current_user,c.oid,'SELECT') allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pm' AND c.relname=$1",[table])).rows[0].allowed,false);
        await db.query('RESET ROLE');
      }
    });
    await isolated('cloud-only seed preserves cursors, source IDs, dispositions, and unknown pending',async()=>{
      const value=await context();assert.deepEqual(value.checkpoints,Object.fromEntries(chats.map(c=>[c,c===chats[0]?'106':'0'])));
      assert.deepEqual(value.pending.map(s=>s.sourceId).sort(),['old-digest','old-redacted','old-unknown']);
      assert.deepEqual(value.unresolved.map(s=>s.sourceId),['old-unresolved']);
      assert.equal(value.pending.find(s=>s.sourceId==='old-redacted').text,null);
      const part=value.graph.entities.find(e=>e.id==='part');assert.equal(part.quantity,42);assert.deepEqual(part.custom,{keep:true});assert.equal(part.rawLog,undefined);assert.equal(part.sourceExcerpt,undefined);
      assert.deepEqual(value.graph.relations[0],{id:'old-link',type:'records_on',from:'old-event',to:'part',custom:'keep'});
      assert(!value.graph.entities.some(e=>e.id==='foreign-person'));assert(!JSON.stringify(value).includes('fixture-secret'));assert(value.projects.some(p=>p.id==='active'));assert(!value.projects.some(p=>p.id==='foreign'));assert(Number.isFinite(Date.parse(value.fetchedAt)));
    });
    await isolated('collection retains fields, exact IDs, duplicate idempotence, monotonic cursors',async()=>{
      const m=message(),first=await collect(m);assert.equal(first.added,1);assert.equal(first.duplicates,0);assert.equal(first.checkpoints[m.chatId],m.logId);
      const retained=await pending(m);assert.equal(retained.text,m.text);assert.equal(retained.metadata.senderId,m.authorId);assert.deepEqual(retained.metadata.senderNameCandidates,m.senderNameCandidates);assert.equal(retained.metadata.sentAt,m.time);
      const before=(await db.query('SELECT * FROM pm.sources WHERE id=$1',[retained.sourceId])).rows[0];
      assert.equal((await collect({...m,sender:'Alternate name',senderNameCandidates:['Alternate name']})).duplicates,1);
      assert.deepEqual((await db.query('SELECT * FROM pm.sources WHERE id=$1',[retained.sourceId])).rows[0],before);
      assert.equal((await collect(message('200'))).checkpoints[m.chatId],m.logId);
      assert.equal((await context()).revision,340);
    });
    await isolated('duplicate hashes accept metadata hash, content digest, and pre-redaction original hash',async()=>{
      for(const [log,text,hash]of [['100','old original',sha('old original')],['105',clean,sha(original)],['106','digest original',sha('digest original')]])assert.equal((await collect(message(log,{text,originalHash:hash,type:log==='105'?51:1}))).duplicates,1);
      assert.equal((await db.query("SELECT id FROM pm.sources WHERE metadata_json::jsonb->>'externalId'='100' AND owner_id=$1",[owner])).rows[0].id,'old-event');
      const redacted=message('107',{type:51,text:clean,originalHash:sha(original)});await collect(redacted);assert.equal((await collect(redacted)).duplicates,1);assert.equal((await context()).pending.find(s=>s.metadata.externalId==='107').text,null);
    });
    await isolated('canonical room labels and author/sender aliases preserve retained originals',async()=>{
      const labels=['LS Production 1','SMT','NEXLIDE MQ','이노텍 이정호 개발팀 1:1'];
      const original=(await db.query("SELECT * FROM pm.sources WHERE id='old-unknown'")).rows[0];
      const historical=(await context()).pending.find(s=>s.sourceId==='old-unknown');
      assert.equal(historical.metadata.roomName,labels[0]);assert.equal(historical.metadata.authorId,'3389141');assert.equal(historical.metadata.sender,'Fixture sender');
      assert.deepEqual((await db.query("SELECT * FROM pm.sources WHERE id='old-unknown'")).rows[0],original);
      await collect(chats.map(chatId=>message('500',{chatId,sender:'Raw display name',senderNameCandidates:['Raw display name','Other name']})));
      for(const [index,chat]of chats.entries()){
        const retained=(await context()).pending.find(s=>s.metadata.roomId===chat&&s.metadata.externalId==='500');
        assert.equal(retained.metadata.roomName,labels[index]);assert.equal(retained.metadata.authorId,retained.metadata.senderId);
        assert.equal(retained.metadata.sender,'Raw display name');assert.equal(retained.metadata.senderName,'Raw display name');
        const row=(await db.query('SELECT * FROM pm.sources WHERE id=$1',[retained.sourceId])).rows[0];
        assert.equal(JSON.parse(row.metadata_json).roomName,labels[index]);assert.equal(JSON.parse(row.metadata_json).authorId,'3389141');
        await collect(message('500',{chatId:chat,sender:'Other name',senderNameCandidates:['Other name']}));
        assert.deepEqual((await db.query('SELECT * FROM pm.sources WHERE id=$1',[retained.sourceId])).rows[0],row);
      }
    });
    await isolated('invalid collection shapes, rooms, DM authors, and identity are atomic',async()=>{
      for(const value of [null,{},Array(101).fill(message()),[null],[{}],[message('1',{chatId:'123'})],[message('1',{chatId:chats[3],authorId:'999'})],[message('1',{logId:3953216721672443340})],[message('1',{authorId:null})],[message('1',{text:null})],[message('1',{senderNameCandidates:null})],[message('1',{senderNameCandidates:[null]})],[message('1',{time:'yesterday'})],[message('1',{type:null})],[message('1',{originalHash:null})]])await assert.rejects(rpc('collect',value),/KAKAO_|INVALID_/);
      await collect();const before=await context();
      await assert.rejects(collect([message('9999999999999999999'),message(undefined,{text:'changed',originalHash:sha('changed')})]),/KAKAO_ORIGINAL_CONFLICT/);
      assert.deepEqual((await context()).checkpoints,before.checkpoints);assert.equal((await context()).pending.length,before.pending.length);
      for(const extra of [{authorId:'777'},{time:'2026-10-18T10:00:00-06:00'},{type:2}])await assert.rejects(collect(message(undefined,extra)),/KAKAO_ORIGINAL_CONFLICT/);
    });
    await isolated('source-only and unresolved reviews commit once and replay atomically',async()=>{
      const s=await pending(),payload=review(s.sourceId),originalRow=(await db.query('SELECT * FROM pm.sources WHERE id=$1',[s.sourceId])).rows[0];
      const result=await rpc('review',payload);assert.equal(result.changed,0);assert.equal(result.revision,340);assert.deepEqual(await rpc('review',payload),result);
      assert(!(await context()).pending.some(x=>x.sourceId===s.sourceId));assert.deepEqual((await db.query('SELECT * FROM pm.sources WHERE id=$1',[s.sourceId])).rows[0],originalRow);
      await rejectReview({...payload,key:sha('different'),items:[{...payload.items[0],reason:'Changed'}]},/KAKAO_SOURCE_ALREADY_REVIEWED/);
      await rejectReview({...payload,items:[{...payload.items[0],reason:'Changed'}]},/REQUEST_KEY_REUSED/);
      const next=await pending(message('3953216721672443341'));const unresolved=review(next.sourceId,{key:sha('unresolved'),items:[{sourceId:next.sourceId,disposition:'unresolved',reason:'Identity uncertain',eventIds:[]}]});await rpc('review',unresolved);assert((await context()).unresolved.some(x=>x.sourceId===next.sourceId));
    });
    await isolated('source-backed private business Event review and replay preserve production rows',async()=>{
      const s=await pending(),payload=eventReview(s.sourceId);const result=await rpc('review',payload);assert.equal(result.changed,4);assert.equal(result.revision,340);assert.deepEqual(await rpc('review',payload),result);
      const state=await context();assert(state.graph.entities.some(e=>e.id==='new-event'));assert(!state.pending.some(x=>x.sourceId===s.sourceId));assert.equal(state.graph.entities.find(e=>e.id==='part').quantity,42);
      assert.deepEqual((await db.query('SELECT event_ids FROM pm.kakao_messages WHERE owner_id=$1 AND source_id=$2',[owner,s.sourceId])).rows[0].event_ids,['new-event']);
    });
    await isolated('review boundary rejects nulls, forged source IDs, duplicate items, and dishonest eventIds',async()=>{
      const s=await pending(),base=review(s.sourceId);
      for(const value of [null,{}, {...base,key:null},{...base,items:null},{...base,changes:null},{...base,items:[]},{...base,items:[null]},{...base,items:[{...base.items[0],sourceId:null}]},{...base,items:[{...base.items[0],reason:null}]},{...base,items:[{...base.items[0],eventIds:null}]},{...base,items:[{...base.items[0],disposition:null}]},{...base,items:[base.items[0],base.items[0]]},{...base,items:[{...base.items[0],sourceId:'foreign-source'}]},{...base,items:[{...base.items[0],sourceId:'unapproved'}]},{...base,items:[{...base.items[0],eventIds:['invented']}]},{...base,items:[{...base.items[0],disposition:'event',eventIds:['invented']}]}])await rejectReview(value);
      assert((await context()).pending.some(x=>x.sourceId===s.sourceId));
    });
    await isolated('strict review wrapper rejects production updates, existing objects, bad scopes, and forged evidence',async()=>{
      const s=await pending(),base=eventReview(s.sourceId);
      const mutate=(index,fn)=>{const p=structuredClone(base),row=p.changes[index].row,data=JSON.parse(row.data_json);fn(p,row,data);row.data_json=JSON.stringify(data);return p;};
      const attacks=[
        {...base,changes:[{table:'wip_counts',id:'count',row:{id:'count',quantity:1}}]},
        {...base,changes:[{table:'project_memberships',id:'membership',row:{project_id:'active',entity_id:'part'}}]},
        mutate(0,(p,r,d)=>{r.id=d.id=p.changes[0].id='part';r.type=d.type='Part';p.changes[0].before={data_json:'{}'};}),
        mutate(0,(p,r,d)=>{r.id=d.id=p.changes[0].id='old-person';r.type=d.type='Person';}),
        mutate(0,(p,r,d)=>{d.privacy='public';}),mutate(0,(p,r,d)=>{d.eventRecord.recordClass='production_log';}),
        mutate(0,(p,r,d)=>{d.eventRecord.scope.projectIds=['archived'];}),mutate(0,(p,r,d)=>{d.eventRecord.scope.projectIds=['foreign'];}),
        mutate(0,(p,r,d)=>{d.eventRecord.scope={kind:'shared',projectIds:[]};}),mutate(0,(p,r,d)=>{d.eventRecord.scope=null;}),
        mutate(0,(p,r,d)=>{d.eventRecord.statementMode='completed';}),mutate(0,(p,r,d)=>{d.name=null;}),
        mutate(1,(p,r,d)=>{d.sourceId='foreign-source';}),mutate(1,(p,r,d)=>{d.sourceId='unapproved';}),
        mutate(1,(p,r,d)=>{r.type=d.type='Person';}),
        mutate(2,(p,r,d)=>{r.from_id=d.from='part';}),mutate(2,(p,r,d)=>{r.to_id=d.to='part';}),
        mutate(2,(p,r,d)=>{r.to_id=d.to='foreign-person';}),mutate(2,(p,r,d)=>{r.type=d.type='assigned_to';}),
        mutate(2,(p,r,d)=>{r.scope_project_id=d.scopeProjectId='archived';}),
        mutate(2,(p,r,d)=>{r.id=d.id=p.changes[2].id='old-link';}),
        {...base,items:[{...base.items[0],eventIds:[]}]},
        {...base,items:[{...base.items[0],disposition:'source_only',eventIds:[]}]},
        {...base,changes:base.changes.slice(0,2)},
        mutate(1,(p,r,d)=>{r.owner_id=other;}),
      ];
      for(const payload of attacks)await rejectReview(payload);
      assert.equal((await db.query("SELECT count(*)::integer n FROM pm.entities WHERE id='new-event'")).rows[0].n,0);
      assert((await context()).pending.some(x=>x.sourceId===s.sourceId));
    });
    await isolated('unassigned events, new private contacts, and existing source-backed Evidence are allowed',async()=>{
      const s=await pending(),payload=eventReview(s.sourceId);
      await putEntity({id:'retained-evidence',type:'Evidence',name:'Existing evidence',status:'active',privacy:'local_only',sourceId:s.sourceId});
      payload.changes.splice(1,1);const record=JSON.parse(payload.changes[0].row.data_json);record.eventRecord.scope={kind:'unassigned',projectIds:[]};payload.changes[0].row.data_json=JSON.stringify(record);
      payload.changes[1].row.to_id='retained-evidence';const link=JSON.parse(payload.changes[1].row.data_json);link.to='retained-evidence';payload.changes[1].row.data_json=JSON.stringify(link);
      for(const type of ['Person','Organization']){
        const id='new-'+type,data={id,type,name:type,status:'active',privacy:'local_only'};payload.changes.push({table:'entities',id,row:{id,type,data_json:JSON.stringify(data)}});
        const rel={id:'performed-'+type,type:'performed_by',from:'new-event',to:id,scopeProjectId:null};payload.changes.push({table:'relations',id:rel.id,row:{id:rel.id,type:rel.type,from_id:rel.from,to_id:id,scope_project_id:null,data_json:JSON.stringify(rel)}});
      }
      assert.equal((await rpc('review',payload)).changed,7);
    });
    await isolated('publisher conflict rolls back both review ledger and new rows',async()=>{
      const s=await pending(),payload=eventReview(s.sourceId);
      await db.query('SELECT public.pm_ingest_local_history($1,$2)',[token,{key:payload.key,changes:[]}]);
      await rejectReview(payload,/REQUEST_KEY_REUSED|KAKAO_/);
      assert((await context()).pending.some(x=>x.sourceId===s.sourceId));assert.equal((await db.query('SELECT count(*)::integer n FROM pm.kakao_reviews')).rows[0].n,0);
    });
    await isolated('JSON identity fields and nullable Event dates retain their declared shapes',async()=>{
      const s=await pending(),base=eventReview(s.sourceId);
      // Numeric and string JSON IDs must not become interchangeable through ->> coercion.
      await putEntity({id:'123',type:'Part',name:'Numeric-looking ID',status:'active'});
      const malformed=structuredClone(base),relation=malformed.changes[3].row;
      relation.to_id='123';const data=JSON.parse(relation.data_json);data.to=123;relation.data_json=JSON.stringify(data);
      await rejectReview(malformed);
      const badDate=structuredClone(base),event=JSON.parse(badDate.changes[0].row.data_json);
      event.eventRecord.occurredDate='2026-02-30';badDate.changes[0].row.data_json=JSON.stringify(event);await rejectReview(badDate);
    });
    await isolated('actual bridge buildReview output commits through the SQL contract',async()=>{
      if(!fs.existsSync(path.join(__dirname,'kakao-cloud.js')))return t.diagnostic('Parallel bridge not present; standalone SQL fixtures still run.');
      const s=await pending(),value=await context();
      // Repair the deliberately incomplete historical relation used by the context projection fixture.
      await putEntity({id:'old-event',type:'Event',name:'Historical event',status:'active',privacy:'local_only'});
      value.graph=(await context()).graph;
      const payload=require('./kakao-cloud').buildReview(value,{items:[{sourceId:s.sourceId,disposition:'event',reason:'Reported delay'}],events:[{key:'bridge-fixture',sourceIds:[s.sourceId],title:'Shipment delayed',summary:'Reported, not verified',kind:'disruption',statementMode:'reported_fact',projectIds:['active'],subjectIds:['part']}]});
      const result=await rpc('review',payload);assert.equal(result.changed,payload.changes.length);assert.deepEqual(await rpc('review',payload),result);
    });
    await t.test('concurrent collection and review serialize on the pinned revision',async()=>{
      const left=new Client({connectionString:url.toString()}),right=new Client({connectionString:url.toString()});
      await left.connect();await right.connect();
      try{
        const m=message('3953216721672443399'),params=[token,JSON.stringify([m])];
        const responses=await Promise.all([left,right].map(client=>client.query('SELECT public.pm_kakao_collect($1,$2) value',params)));
        assert.deepEqual(responses.map(r=>r.rows[0].value.added).sort(),[0,1]);
        assert.deepEqual(responses.map(r=>r.rows[0].value.duplicates).sort(),[0,1]);
        assert.equal((await db.query("SELECT count(*)::integer n FROM pm.sources WHERE metadata_json::jsonb->>'externalId'=$1",[m.logId])).rows[0].n,1);
        const sourceId=(await db.query('SELECT source_id FROM pm.kakao_messages WHERE log_id=$1',[m.logId])).rows[0].source_id;
        const payload=review(sourceId),results=await Promise.all([left,right].map(client=>client.query('SELECT public.pm_kakao_review($1,$2) value',[token,payload])));
        assert.deepEqual(results[0].rows[0].value,results[1].rows[0].value);
        assert.equal((await db.query('SELECT count(*)::integer n FROM pm.kakao_reviews')).rows[0].n,1);
      }finally{await left.end();await right.end();}
    });
  }finally{
    if(db)await db.end();
    await admin.query('DROP DATABASE IF EXISTS '+database);await admin.end();
  }
});
