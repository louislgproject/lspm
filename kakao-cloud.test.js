'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
let B={};try{B=require('./kakao-cloud');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const chat='453981707667079',log='3953242206908932097';
const message={chatId:chat,logId:log,authorId:'3148435',sender:'Reporter',senderNameCandidates:['Reporter'],time:'2026-10-18T09:00:00-06:00',type:1,text:'Stop the line'};
test('normalizes exact IDs, collapses JOIN duplicates and rejects conflicting originals',()=>{
 a.equal(typeof B.normalizeMessages,'function');const rows=B.normalizeMessages([message,{...message,sender:'Other display',senderNameCandidates:['Other display']}]);
 a.equal(rows.length,1);a.equal(rows[0].logId,log);a.deepEqual(rows[0].senderNameCandidates,['Reporter','Other display']);
 a.throws(()=>B.normalizeMessages([{...message,chatId:'999'}]),/ROOM_NOT_ALLOWED/);
 a.throws(()=>B.normalizeMessages([{...message,logId:Number(log)}]),/INVALID_MESSAGE_ID/);
 a.throws(()=>B.normalizeMessages([message,{...message,text:'Changed'}]),/CONFLICTING_ORIGINAL/);
});
test('protocol credential redaction retains original provenance hash',()=>{
 a.equal(typeof B.normalizeMessages,'function');const original='\uFEFF{"cdrToken":"secret-value","text":"Retain work text"}';const row=B.normalizeMessages([{...message,type:51,text:original}])[0];
 a.ok(!row.text.includes('secret-value'));a.ok(row.text.includes('Retain work text'));a.equal(row.originalHash,require('node:crypto').createHash('sha256').update(original).digest('hex'));
});
test('collection reads cloud checkpoints and never opens a local ontology database',async()=>{
 a.equal(typeof B.collect,'function');const calls=[],context={checkpoints:{[chat]:'3953242206908932000'}};
 const result=await B.collect({rpc:async(name,args)=>{calls.push(name);if(name==='pm_kakao_context')return context;return{added:1,duplicates:0,checkpoints:{[chat]:log}};},readMessages:async bounds=>{a.deepEqual(bounds,context.checkpoints);return{dmVerified:true,messages:[message]};}});
 a.equal(result.added,1);a.deepEqual(calls,['pm_kakao_context','pm_kakao_collect']);
 a.doesNotMatch(fs.readFileSync(require.resolve('./kakao-cloud'),'utf8'),/node:sqlite|local-store|publish-supabase|ontology\.sqlite|supabase-publish-state/);
});
test('failed cloud storage leaves the cloud cursor retryable and never acknowledges success',async()=>{
 a.equal(typeof B.collect,'function');let uploads=0;
 const options={rpc:async name=>{if(name==='pm_kakao_context')return{checkpoints:{[chat]:'0'}};uploads++;throw Error('CLOUD_UNAVAILABLE');},readMessages:async()=>({dmVerified:true,messages:[message]})};
 await a.rejects(B.collect(options),/CLOUD_UNAVAILABLE/);await a.rejects(B.collect(options),/CLOUD_UNAVAILABLE/);a.equal(uploads,2);
});
for(const failure of ['second batch before commit','first acknowledgement after commit'])test('101 messages survive '+failure+' and retry from server cursor',async()=>{
 const first=BigInt(log),messages=Array.from({length:101},(_,i)=>({...message,logId:(first+BigInt(i)).toString(),time:i===0?'2026-10-18T10:00:00-06:00':message.time,text:'Original '+i}));
 // Timestamp order deliberately puts the lowest log ID in the final batch.
 const readerOrder=[...messages.slice(1),messages[0]],stored=new Map(),batches=[],boundsRead=[];
 let cursor=(first-1n).toString(),uploads=0,fail=true;
 const options={
  rpc:async(name,args)=>{
   if(name==='pm_kakao_context')return{checkpoints:{[chat]:cursor}};
   a.equal(name,'pm_kakao_collect');uploads++;batches.push(args.p_messages.map(m=>m.logId));
   if(fail&&failure==='second batch before commit'&&uploads===2){fail=false;throw Error('SECOND_BATCH_FAILED');}
   let added=0,duplicates=0;
   for(const m of args.p_messages){if(stored.has(m.logId))duplicates++;else{stored.set(m.logId,m);added++;}if(BigInt(m.logId)>BigInt(cursor))cursor=m.logId;}
   if(fail&&failure==='first acknowledgement after commit'){fail=false;throw Error('ACK_LOST_AFTER_COMMIT');}
   return{added,duplicates,checkpoints:{[chat]:cursor}};
  },
  readMessages:async bounds=>{boundsRead.push(bounds[chat]);return{dmVerified:true,messages:readerOrder.filter(m=>BigInt(m.logId)>BigInt(bounds[chat]))};},
 };
 await a.rejects(B.collect(options),failure==='second batch before commit'?/SECOND_BATCH_FAILED/:/ACK_LOST_AFTER_COMMIT/);
 a.equal(stored.size,100);const committedCursor=cursor;
 const retry=await B.collect(options);
 a.equal(boundsRead[1],committedCursor);a.equal(stored.size,101,'Retry must retain every original despite timestamp/log disagreement');
 a.equal(retry.added,1);a.equal(cursor,messages.at(-1).logId);
 a.deepEqual(batches[0],messages.slice(0,100).map(m=>m.logId));
 for(const m of messages){a.equal(stored.get(m.logId).text,m.text);a.equal(stored.get(m.logId).time,m.time);}
 a.equal((await B.collect(options)).added,0);a.equal(stored.size,101);
});
test('normalization groups rooms and orders adjacent large log IDs exactly',()=>{
 const next=(BigInt(log)+1n).toString(),other=B.ROOMS[1];
 const input=[{...message,chatId:other,logId:next},{...message,logId:next},{...message,chatId:other},{...message}];
 a.deepEqual(B.normalizeMessages(input).map(m=>[m.chatId,m.logId]),[[chat,log],[chat,next],[other,log],[other,next]]);
 a.deepEqual(input.map(m=>[m.chatId,m.logId]),[[other,next],[chat,next],[other,log],[chat,log]]);
});
test('Python reader orders its checkpoint query by log ID and preserves reported timestamps',()=>{
 const script=String.raw`
import importlib.util, sqlite3, sys
spec = importlib.util.spec_from_file_location('kakao_cloud_reader', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
db = sqlite3.connect(':memory:')
db.executescript('CREATE TABLE NTChatMeta(chatId INTEGER,type INTEGER,content TEXT);CREATE TABLE NTUser(userId INTEGER,displayName TEXT);CREATE TABLE NTChatMessage(chatId INTEGER,logId INTEGER,authorId INTEGER,sentAt INTEGER,type INTEGER,message TEXT);')
for name, cid in module.ROOMS:
    db.execute('INSERT INTO NTChatMeta VALUES(?,3,?)', (cid, name))
db.execute('INSERT INTO NTUser VALUES(3389141,?)', ('Reporter',))
db.executemany('INSERT INTO NTChatMessage VALUES(?,?,?,?,1,?)', [
    (module.ROOMS[0][1], 3953242206908932097, 3389141, 1792339200, 'Late timestamp'),
    (module.ROOMS[0][1], 3953242206908932098, 3389141, 1792335600, 'Early timestamp'),
    (module.DM, 1, 3389141, 1792335600, 'DM one'),
    (module.DM, 2, 55304262, 1792335600, 'DM two')])
class Reader:
    def _query(self, sql):
        return db.execute(sql).fetchall()
result = module.read_messages(Reader(), {cid: '0' for cid in [c[1] for c in module.ROOMS] + [module.DM]})
rows = [m for m in result['messages'] if m['chatId'] == module.ROOMS[0][1]]
assert [m['logId'] for m in rows] == ['3953242206908932097', '3953242206908932098'], rows
assert rows[0]['time'] > rows[1]['time']
assert [m['text'] for m in rows] == ['Late timestamp', 'Early timestamp']
`;
 require('node:child_process').execFileSync('python3',['-B','-c',script,require('node:path').join(__dirname,'kakao-cloud-reader.py')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
});
test('retired publisher cannot accidentally reopen the old operational pipeline',()=>{
 const result=require('node:child_process').spawnSync(process.execPath,[require('node:path').join(__dirname,'publish-supabase.js')],{encoding:'utf8',env:{...process.env,PM_DB_PATH:'/nonexistent/retired-fixture.sqlite'}});
 a.equal(result.status,1);a.match(result.stderr,/LOCAL_PM_PUBLISHER_RETIRED/);
});
test('review creates only private source-backed History without changing production state',()=>{
 a.equal(typeof B.buildReview,'function');const context={fetchedAt:'2026-10-18T15:00:00.123456+00:00',graph:{entities:[{id:'part',type:'Part',name:'Part',status:'active'}],relations:[]},projects:[{id:'project',status:'active'}],pending:[{sourceId:'source',text:message.text,metadata:{senderId:message.authorId,senderName:message.sender,roomId:chat,externalId:log,sentAt:message.time,sourceType:1}}]};
 const input={items:[{sourceId:'source',disposition:'event',reason:'Explicit stop request'}],events:[{key:'stop',title:'Stop requested',summary:'Reporter requests a stop; execution unconfirmed.',kind:'request',statementMode:'requested',sourceIds:['source'],subjectIds:['part'],projectIds:['project']}]};
 const one=B.buildReview(context,input),two=B.buildReview(context,input);a.deepEqual(one,two);
 a.deepEqual(one.items[0].eventIds,one.changes.filter(c=>c.table==='entities'&&c.row.type==='Event').map(c=>c.id));
 const event=JSON.parse(one.changes.find(c=>c.row?.type==='Event').row.data_json);a.equal(event.privacy,'local_only');a.equal(event.eventRecord.recordClass,'business');a.equal(event.eventRecord.occurredAt,null);
 a.ok(one.changes.every(c=>['entities','relations'].includes(c.table)));a.ok(one.changes.every(c=>c.id!=='part'));
 a.throws(()=>B.buildReview(context,{...input,events:[{...input.events[0],sourceIds:['unknown']}]}),/SOURCE_NOT_IN_REVIEW/);
});
