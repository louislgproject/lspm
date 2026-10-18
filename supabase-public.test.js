const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Client}=require('pg');
const path=require('node:path');
const {applyMigrations}=require('./scripts/supabase-migrations');
const {withPostgresStore,withPublicPostgresStore}=require('./postgres-store');
const {createCloudHandler}=require('./cloud-handler');
const {createPublicDataStore}=require('./public-data-api');
const {inspectData}=require('./scripts/inspect-supabase-data');
const Projects=require('./projects'),Model=require('./ontology-model');

test('public workspace is pinned, readable without login, and cannot be changed by guests', {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const admin=new Client({connectionString:process.env.TEST_DATABASE_URL});await admin.connect();
  const dbName='pm_public_'+randomUUID().replaceAll('-','');let client;
  try{
    await admin.query('CREATE DATABASE '+dbName);const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+dbName;
    client=new Client({connectionString:url.toString()});await client.connect();
    await client.query("CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE TABLE auth.users(id UUID PRIMARY KEY)");
    const owner=randomUUID(),other=randomUUID();await client.query('INSERT INTO auth.users(id) VALUES ($1)',[owner]);
    // Test bootstrap does not need an anonymous database role; production Supabase has it.
    await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$");
    await applyMigrations(async sql=>(await client.query(sql)).rows,path.join(__dirname,'supabase/migrations'),()=>{});
    const inspect=()=>inspectData(async sql=>(await client.query(sql)).rows);
    assert.equal((await inspect()).status,'NO_OBJECTS');
    assert.equal((await client.query('SELECT owner_id FROM pm.publication')).rows[0].owner_id,owner);
    let ws=await withPostgresStore(client,owner,s=>s.load());ws.projects.push(Projects.create('Visible project'));
    ws=await withPostgresStore(client,owner,s=>s.save(ws,null,ws.revision));
    const evidence=Model.addEntity(ws.library,{type:'Evidence',name:'Visible evidence',rawLog:'private source bytes'});
    evidence.sourceExcerpt='private excerpt';
    const part=Model.addEntity(ws.library,{type:'Part',name:'Visible part'});
    const link=Model.addRelation(ws.library,{type:'supported_by',from:part.id,to:evidence.id});link.sourceExcerpt='private link excerpt';
    const step=Model.addEntity(ws.library,{type:'Production Step',name:'Router'});
    Model.addRelation(ws.library,{type:'applies_to',from:step.id,to:part.id});
    ws=await withPostgresStore(client,owner,s=>s.save(ws,'library',ws.revision));
    const projectId=ws.projects[0].id;
    ws.projects[0].entities=ws.library.entities.map(e=>({...e,projectId}));
    ws.projects[0].relations=ws.library.relations.map(r=>({...r,projectId}));
    ws.projects[0].entities.find(e=>e.id===step.id).plannedStart='2026-10-17';
    ws.projects[0].workstreams={[part.id]:['production']};
    ws=await withPostgresStore(client,owner,s=>s.save(ws,projectId,ws.revision));
    ws=await withPostgresStore(client,owner,s=>s.saveWip({projectId,revision:ws.revision,capturedAt:'2026-10-17T08:00:00Z',filename:'mes.xlsx',sheet:'WIP',rows:[{row:1,column:2,partName:part.name,partId:part.id,stepId:step.id,stage:'Router',quantity:0}]}));
    ws=await withPostgresStore(client,owner,s=>s.saveStaffing({projectId,revision:ws.revision,partId:part.id,count:3,capturedAt:'2026-10-17T08:00:00Z'}));
    ws=await withPostgresStore(client,owner,s=>s.saveProductionStaffing({projectId,revision:ws.revision,targetId:step.id,targetType:'Production Step',count:2,capturedAt:'2026-10-17T08:00:00Z'}));
    await withPostgresStore(client,owner,s=>s.putSettings(projectId,'production',{zoom:1.5}));
    let hidden=await withPostgresStore(client,other,s=>s.load());hidden.projects.push(Projects.create('Other private account'));
    await withPostgresStore(client,other,s=>s.save(hidden,null,hidden.revision));
    const visible=await inspect();assert.equal(visible.status,'PUBLIC_DATA_PRESENT');
    assert.equal(visible.counts.total_objects,3);assert.equal(visible.counts.public_objects,3);
    assert.equal(visible.counts.total_projects,2);assert.equal(visible.counts.public_projects,1);
    await client.query('BEGIN');
    try{
      await client.query('UPDATE pm.publication SET owner_id=$1',[randomUUID()]);
      const unlinked=await inspect();assert.equal(unlinked.status,'PUBLIC_WORKSPACE_EMPTY');assert.equal(unlinked.counts.total_objects,3);assert.equal(unlinked.counts.public_objects,0);
    }finally{await client.query('ROLLBACK');}
    const anonRead=async(operation,project='',snapshot='')=>{
      await client.query('BEGIN');
      try{await client.query('SET LOCAL ROLE anon');const result=await client.query('SELECT public.pm_public_read($1,$2,$3) AS value',[operation,project,snapshot]);await client.query('COMMIT');return result.rows[0].value;}
      catch(error){await client.query('ROLLBACK');throw error;}
    };
    const dataStore=createPublicDataStore({url:'https://example.supabase.co',apiKey:'public-key',fetchImpl:async(url,options)=>{
      assert.equal(url,'https://example.supabase.co/rest/v1/rpc/pm_public_read');assert.equal(options.headers.apikey,'public-key');
      const body=JSON.parse(options.body);
      try{return Response.json(await anonRead(body.operation,body.project_id,body.snapshot_id));}
      catch(error){return Response.json({code:error.code},{status:400});}
    }});
    const handler=createCloudHandler({allowedOrigins:['https://louiscxcix.github.io'],authenticate:async()=>{throw Error('No login');},withStore:()=>{throw Error('No login');},withPublicStore:fn=>fn(dataStore)});
    // Use the function-name prefix delivered by Supabase's hosted runtime.
    const request=(route,method='GET')=>handler(new Request('https://example.supabase.co/ontology/api/'+route,{method}));
    let response=await request('public/workspace?owner_id='+other);assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.projects.length,1);assert.equal(data.projects[0].name,'Visible project');
    assert.equal(data.pendingChange,null);assert.deepEqual(data.library.changes,[]);
    assert.equal(data.library.entities[0].rawLog,undefined);assert.equal(data.library.entities[0].sourceExcerpt,undefined);
    assert.equal(data.library.relations[0].sourceExcerpt,undefined);
    const expected=await withPublicPostgresStore(client,s=>s.load());expected.pendingChange=null;
    for(const graph of [expected.library,...expected.projects]){graph.changes=[];for(const e of graph.entities){delete e.rawLog;delete e.sourceExcerpt;}for(const r of graph.relations)delete r.sourceExcerpt;}
    assert.deepEqual(data,expected);
    assert.deepEqual(await dataStore.listWip(projectId),await withPostgresStore(client,owner,s=>s.listWip(projectId)));
    assert.deepEqual(await dataStore.listStaffing(projectId),await withPostgresStore(client,owner,s=>s.listStaffing(projectId)));
    assert.deepEqual(await dataStore.listProductionStaffing(projectId),await withPostgresStore(client,owner,s=>s.listProductionStaffing(projectId)));
    assert.equal((await anonRead('workspace',projectId,other)).projects[0].name,'Visible project');
    await assert.rejects(anonRead('export'),/Unsupported public operation/);
    await assert.rejects(anonRead('wip',hidden.projects[0].id),/Unknown project/);
    assert.equal((await request('public/workspace','POST')).status,405);
    assert.equal((await request('workspace','POST')).status,401);
    assert.equal((await request('public/export')).status,404);
    response=await request('public/health');assert.deepEqual(await response.json(),{ok:true,readOnly:true,mapAssistantConfigured:false,copilotConfigured:false});
    // Latest production tables use the same owner boundary and read-only public RPC.
    const fresh=await withPostgresStore(client,owner,s=>s.load());fresh.projects[0].projectType='sample';
    await withPostgresStore(client,owner,s=>s.save(fresh,projectId,fresh.revision));
    let current=await withPostgresStore(client,owner,s=>s.load());
    assert.equal(current.projects[0].projectType,'sample');
    await withPostgresStore(client,owner,s=>s.hourlySave({projectId,revision:current.revision,text:'private raw source',rows:[{measurementKind:'model',partId:part.id,unit:'pcs',start:'2026-10-17T09:00:00-06:00',end:'2026-10-17T10:00:00-06:00',actual:0,target:20}]}));
    current=await withPostgresStore(client,owner,s=>s.load());
    const S=require('./sample-preparation');let sheet=S.create(current.projects[0],{partId:part.id,runName:'Cloud trial'});
    let saved=await withPostgresStore(client,owner,s=>s.samplePreparationSave({projectId,revision:current.revision,sheet}));
    sheet={...saved.sheet,memo:'Latest version'};
    saved=await withPostgresStore(client,owner,s=>s.samplePreparationSave({projectId,revision:saved.revision,sheet}));
    await assert.rejects(withPostgresStore(client,owner,s=>s.samplePreparationSave({projectId,revision:saved.revision,sheet})),/SHEET_VERSION_CONFLICT/);
    const productionRead=async(operation,id=projectId)=>{await client.query('BEGIN');try{await client.query('SET LOCAL ROLE anon');const out=(await client.query('SELECT public.pm_public_production_read($1,$2) AS value',[operation,id])).rows[0].value;await client.query('COMMIT');return out;}catch(e){await client.query('ROLLBACK');throw e;}};
    const hourly=await productionRead('hourly');assert.equal(hourly.length,1);assert.equal(hourly[0].actual,0);assert.equal(hourly[0].sourceId,undefined);
    const sheets=await productionRead('sample-preparation');assert.equal(sheets.length,1);assert.equal(sheets[0].version,2);assert.deepEqual(sheets[0],S.sanitize(saved.sheet));
    const progress=await productionRead('progress');assert.equal(progress.rows[0].quantity,0);assert.deepEqual(progress,await withPostgresStore(client,owner,s=>s.listProgress(projectId)));
    await assert.rejects(productionRead('hourly',hidden.projects[0].id),/Unknown project/);
    await assert.rejects(productionRead('export'),/Unsupported public operation/);
    await assert.rejects(withPostgresStore(client,other,s=>s.hourlySave({projectId,revision:1,rows:[]})),/Unknown project|STALE_REVISION/);
    await assert.rejects(withPublicPostgresStore(client,s=>s.putSettings('library','library',{zoom:2})),/read.only transaction/);
  }finally{if(client)await client.end();await admin.query('DROP DATABASE IF EXISTS '+dbName);await admin.end();}
});
