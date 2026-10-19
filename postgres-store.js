'use strict';

const {createStore} = require('./store-core');

// SQL is generated only by store-core; never accept SQL or identifiers from clients.
function postgresSql(sql) {
  if (/^INSERT OR IGNORE /i.test(sql)) sql=sql.replace('INSERT OR IGNORE','INSERT')+' ON CONFLICT DO NOTHING';
  sql=sql.replace(/ON CONFLICT\(([^)]+)\)/g,(_,columns)=>'ON CONFLICT(owner_id,'+columns+')');
  let index=0;
  return sql.replace(/\?/g,()=>'$'+(++index));
}

function postgresAdapter(client) {
  const query=async (sql,params)=>{
    const {rows}=await client.query(postgresSql(sql),params);
    return rows.map(({owner_id,rowid,...row})=>row);
  };
  return {
    prepare:sql=>({
      all:(...params)=>query(sql,params),
      get:async (...params)=>(await query(sql,params))[0],
      run:(...params)=>query(sql,params)
    }),
    exec:sql=>{
      // The request owns one outer transaction, including validation and the revision lock.
      if (/^(BEGIN IMMEDIATE|COMMIT|ROLLBACK)$/.test(sql)) return;
      if(sql==='PRAGMA defer_foreign_keys=ON')return client.query('SET CONSTRAINTS ALL DEFERRED');
      throw Error('Unsupported transaction instruction.');
    },
    close:()=>{}
  };
}

async function run(iterator) {
  let step=iterator.next();
  while(!step.done) {
    try { step=iterator.next(await step.value); }
    catch(error) { step=iterator.throw(error); }
  }
  return step.value;
}

function workspaceFromParts(parts){
  const members=new Map();
  for(const row of parts.memberships||[]){let ids=members.get(row.projectId);if(!ids)members.set(row.projectId,ids=new Set());ids.add(row.entityId);}
  const assessments=new Map((parts.assessments||[]).map(row=>[row.projectId+':'+row.entityId,row.data]));
  const schedules=new Map((parts.schedules||[]).map(row=>[row.projectId+':'+row.entityId,row.data]));
  const entities=(parts.entities||[]).map(entity=>{if(entity.type==='Event'){entity.status||='active';if(entity.sourceId||String(entity.id).startsWith('cloud-event-'))delete entity.rawLog;}return entity;});
  const relations=(parts.relations||[]).map(row=>({...row.data,scopeProjectId:row.scopeProjectId}));
  const changes=parts.changes||[];
  const lanes=parts.lanes||[];
  const library={id:'library',name:'Global Library',status:'active',version:2,entities:entities.map(entity=>({...entity,projectId:'library'})),relations:relations.map(relation=>({...relation,projectId:'library'})),changes:changes.filter(change=>!change.scope).map(change=>change.change)};
  const projects=(parts.projects||[]).map(row=>{
    const member=members.get(row.id)||new Set();
    const projectLanes=lanes.filter(item=>item.projectId===row.id);
    return {...row,version:2,projectType:row.projectType||null,
      entities:entities.filter(entity=>member.has(entity.id)).map(entity=>({...entity,...assessments.get(row.id+':'+entity.id),...schedules.get(row.id+':'+entity.id),projectId:row.id})),
      relations:relations.filter(relation=>(!relation.scopeProjectId||relation.scopeProjectId===row.id)&&member.has(relation.from)&&member.has(relation.to)).map(relation=>({...relation,projectId:row.id})),
      changes:changes.filter(change=>(!change.scope||change.scope===row.id)&&member.has(change.change?.entityId)).map(change=>change.change),
      workstreams:Object.fromEntries([...new Set(projectLanes.map(item=>item.entityId))].map(id=>[id,projectLanes.filter(item=>item.entityId===id).map(item=>item.code)]))};
  });
  const viewSettings={};
  for(const row of parts.settings||[])(viewSettings[row.projectId]||={})[row.viewKey]=row.data;
  return {revision:Number(parts.revision),library,projects,viewSettings,pendingChange:parts.pending||null};
}

async function withPostgresStore(client,userId,operation,options={}) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId||''))throw Error('Authentication required.');
  const readOnly=options.readOnly===true;
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('search_path','pm,public',true)",[userId]);
    await client.query("INSERT INTO pm.meta(key,value) VALUES ('revision','0'),('schema_version','4') ON CONFLICT(owner_id,key) DO NOTHING");
    // Reads must not wait on the write lock. Saves still take it so two edits cannot both succeed.
    await client.query(readOnly?"SELECT value FROM pm.meta WHERE key='revision'":"SELECT value FROM pm.meta WHERE key='revision' FOR UPDATE");
    const generators=createStore(postgresAdapter(client));
    const store=Object.fromEntries(Object.entries(generators).map(([key,method])=>[key,(...args)=>run(method(...args))]));
    const nativeHourly=store.listHourly;
    store.listHourly=async projectId=>{
      const native=await nativeHourly(projectId);
      const available=await client.query("SELECT to_regprocedure('public.pm_report_hourly(text)') IS NOT NULL AS enabled");
      if(!available.rows[0]?.enabled)return native;
      return (await client.query('SELECT public.pm_report_hourly($1) AS value',[projectId])).rows[0].value;
    };
    const result=await operation(store,client);
    await client.query('COMMIT');
    return result;
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports={withPostgresStore,withPublicPostgresStore,postgresSql,workspaceFromParts};

async function withPublicPostgresStore(client,operation){
  await client.query('BEGIN READ ONLY');
  try{
    // This administrator-only selection occurs before switching to the restricted role.
    const {rows}=await client.query('SELECT owner_id FROM pm.publication WHERE singleton=true');
    const userId=rows[0]?.owner_id;
    if(!userId)throw Error('No public workspace configured.');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('search_path','pm,public',true)",[userId]);
    const generators=createStore(postgresAdapter(client));
    const store=Object.fromEntries(Object.entries(generators).map(([key,method])=>[key,(...args)=>run(method(...args))]));
    const result=await operation(store);
    await client.query('COMMIT');
    return result;
  }catch(error){await client.query('ROLLBACK');throw error;}
}
module.exports.withPublicPostgresStore=withPublicPostgresStore;
