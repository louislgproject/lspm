const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),path=require('node:path');
const {applyMigrations}=require('./scripts/supabase-migrations'),{withPostgresStore}=require('./postgres-store'),{createCloudHandler}=require('./cloud-handler'),{createPublicDataStore}=require('./public-data-api');
const M=require('./ontology-model'),Projects=require('./projects');
test('project access protects direct RPCs, Global Library, production reads and rotated sessions',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const admin=new Client({connectionString:process.env.TEST_DATABASE_URL});await admin.connect();const name='access_'+randomUUID().replaceAll('-','');let client;
 try{
  await admin.query('CREATE DATABASE '+name);const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+name;client=new Client({connectionString:url.toString()});await client.connect();
  await client.query("CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE TABLE auth.users(id UUID PRIMARY KEY)");
  const owner=randomUUID(),other=randomUUID();await client.query('INSERT INTO auth.users VALUES($1)',[owner]);await applyMigrations(async s=>(await client.query(s)).rows,path.join(__dirname,'supabase/migrations'),()=>{});
  let w=await withPostgresStore(client,owner,s=>s.load());const open=Projects.create('Open project'),protectedProject=Projects.create('Protected project');w.projects.push(open,protectedProject);w=await withPostgresStore(client,owner,s=>s.save(w,null,w.revision));
  const exclusive=M.addEntity(w.projects[1],{type:'Part',name:'Secret final part'}),shared=M.addEntity(w.projects[1],{type:'Part',name:'Shared part'});M.addRelation(w.projects[1],{type:'part_of',from:exclusive.id,to:shared.id});w=await withPostgresStore(client,owner,s=>s.save(w,protectedProject.id,w.revision));
  w.projects[0].entities.push({...shared,projectId:open.id});w=await withPostgresStore(client,owner,s=>s.save(w,open.id,w.revision));
  await withPostgresStore(client,owner,s=>s.hourlySave({projectId:protectedProject.id,revision:w.revision,rows:[{measurementKind:'model',partId:exclusive.id,unit:'pcs',start:'2026-10-17T08:00:00-06:00',end:'2026-10-17T09:00:00-06:00',actual:7,target:9}]}));
  const role=async(role,sql,args=[])=>{await client.query('BEGIN');try{await client.query('SET LOCAL ROLE '+role);const value=(await client.query(sql,args)).rows[0]?.value;await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}};
  const read=tokens=>role('anon','SELECT public.pm_public_read($1,$2,$3,$4) AS value',['workspace','','',tokens||'']);
  const production=(id,tokens='')=>role('anon','SELECT public.pm_public_production_read($1,$2,$3) AS value',['hourly',id,tokens]);
  const set=(visibility,password='',id=owner)=>withPostgresStore(client,id,async(_store,c)=>(await c.query('SELECT public.pm_set_project_access($1,$2,$3) AS value',[protectedProject.id,visibility,password])).rows[0].value);
  const unlock=password=>role('anon','SELECT public.pm_unlock_project($1,$2) AS value',[protectedProject.id,password]);
  assert.equal((await read()).library.entities.length,2);assert.equal((await production(protectedProject.id)).length,1);
  await set('password','simple-123');let guest=await read();const locked=guest.projects.find(p=>p.id===protectedProject.id);assert.equal(locked.viewPending,true);assert.deepEqual(locked.entities,[]);assert.ok(!JSON.stringify(guest).includes('Secret final part'));assert.ok(guest.library.entities.some(p=>p.id===shared.id));assert.deepEqual(guest.library.relations,[]);
  await assert.rejects(production(protectedProject.id),/access required/);await assert.rejects(role('anon','SELECT pm.pm_public_read($1) AS value',['workspace']),/permission denied/);
  await assert.rejects(role('authenticated','SELECT pm.pm_public_production_read($1,$2) AS value',['hourly',protectedProject.id]),/permission denied/);
  await assert.rejects(role('authenticated','SELECT * FROM pm.project_access'),/permission denied/);
  assert.ok((await unlock(null)).error);assert.ok((await unlock('wrong-password')).error);
  const token=(await unlock('simple-123')).token;assert.match(token,/^[a-f0-9]{64}$/);guest=await read(token);assert.ok(guest.library.entities.some(e=>e.id===exclusive.id));assert.equal((await production(protectedProject.id,token))[0].actual,7);
  await set('password','new-1234');assert.ok(!(await read(token)).library.entities.some(e=>e.id===exclusive.id));await assert.rejects(production(protectedProject.id,token),/access required/);
  const token2=(await unlock('new-1234')).token;await set('private');guest=await read(token2);assert.ok(!guest.projects.some(p=>p.id===protectedProject.id));assert.ok(!guest.library.entities.some(e=>e.id===exclusive.id));assert.ok((await unlock('new-1234')).error);await assert.rejects(set('public','',other),/Unknown project/);
  assert.ok((await withPostgresStore(client,owner,s=>s.load())).projects.some(p=>p.entities.some(e=>e.id===exclusive.id)));
  // Token grants work through the hosted HTTP boundary too, and never authorize writes.
  await set('password','again-123');const grant=(await unlock('again-123')).token;
  const fetchImpl=async(url,options)=>{const b=JSON.parse(options.body);const result=url.endsWith('pm_unlock_project')?await unlock(b.password):url.endsWith('pm_public_production_read')?await production(b.project_id,b.view_tokens):await read(b.view_tokens);return Response.json(result);};
  const handler=createCloudHandler({allowedOrigins:[],authenticate:async()=>({id:owner}),withStore:(_id,fn)=>withPostgresStore(client,owner,fn),withPublicStore:(fn,viewTokens)=>fn(createPublicDataStore({url:'https://test.supabase.co',apiKey:'public',viewTokens,fetchImpl}))});
  const request=(route,opts={})=>handler(new Request('https://test.supabase.co/ontology/api/'+route,opts));
  let response=await request('public/workspace',{headers:{'x-project-access':grant}});assert.ok((await response.json()).projects.find(p=>p.id===protectedProject.id).entities.length);
  assert.equal((await request('public/hourly',{method:'POST',headers:{'x-project-access':grant}})).status,405);
  response=await request('project-access?project='+protectedProject.id,{headers:{Authorization:'Bearer test'}});assert.deepEqual(await response.json(),{visibility:'password'});
  response=await request('project-access',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({projectId:protectedProject.id,visibility:'private',password:''})});assert.equal(response.status,200);assert.ok((await response.json()).projects.some(p=>p.id===protectedProject.id));
  await set('password','rate-test');for(let i=0;i<10;i++)assert.ok((await unlock('incorrect')).error);assert.match((await unlock('rate-test')).error,/Too many/);
  await set('public');assert.equal((await read()).projects.length,2);assert.equal((await production(protectedProject.id)).length,1);
  if(require('node:fs').existsSync(process.env.CHROME_PATH||'/usr/bin/chromium')){
   await set('password','browser-pass');await browserAccessCheck({databaseUrl:url.toString(),owner,projectId:protectedProject.id,exclusiveId:exclusive.id});
  }
 }finally{if(client)await client.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');await admin.end();}
});

async function browserAccessCheck({databaseUrl,owner,projectId,exclusiveId}){
 const http=require('node:http'),{chromium}=require('playwright-core'),{createRequestHandler}=require('./server');
 const connection=async fn=>{const c=new Client({connectionString:databaseUrl});await c.connect();try{return await fn(c);}finally{await c.end();}};
 const publicFetch=async(url,options)=>connection(async c=>{
  await c.query('SET ROLE anon');const b=JSON.parse(options.body);let sql,args;
  if(url.endsWith('pm_unlock_project')){sql='SELECT public.pm_unlock_project($1,$2) AS value';args=[b.project_id,b.password];}
  else if(url.endsWith('pm_public_production_read')){sql='SELECT public.pm_public_production_read($1,$2,$3) AS value';args=[b.operation,b.project_id,b.view_tokens||''];}
  else {sql='SELECT public.pm_public_read($1,$2,$3,$4) AS value';args=[b.operation,b.project_id,b.snapshot_id||'',b.view_tokens||''];}
  try{return Response.json((await c.query(sql,args)).rows[0].value);}catch{return Response.json({error:'Access required.'},{status:403});}
 });
 const handler=createCloudHandler({allowedOrigins:[],authenticate:async token=>{assert.equal(token,'browser-test-token');return {id:owner};},withStore:(id,fn)=>connection(c=>withPostgresStore(c,id,fn)),withPublicStore:(fn,viewTokens)=>fn(createPublicDataStore({url:'https://test.supabase.co',apiKey:'sb_publishable_fixture',fetchImpl:publicFetch,viewTokens}))});
 // Reproduce the Pages origin's cloud connection policy rather than the local-only server policy.
 const assets=createRequestHandler({store:{}}),server=http.createServer((req,res)=>{const set=res.setHeader.bind(res);res.setHeader=(key,value)=>set(key,key==='Content-Security-Policy'?"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://test.supabase.co":value);assets(req,res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/supabase-config.js*',route=>route.fulfill({contentType:'text/javascript',body:"window.PM_SUPABASE_CONFIG={url:'https://test.supabase.co',publishableKey:'sb_publishable_fixture',publicView:true};"}));
  await page.route('https://test.supabase.co/**',async route=>{
   const req=route.request();let response;
   if(req.url().includes('/auth/v1/'))response=Response.json({access_token:'browser-test-token',refresh_token:'fixture',expires_in:3600,user:{id:owner,email:'owner@example.invalid'}});
   else {const headers={...req.headers()};delete headers.origin;response=await handler(new Request(req.url(),{method:req.method(),headers,...(req.postData()?{body:req.postData()}:{})}));}
   await route.fulfill({status:response.status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':origin},body:await response.text()});
  });
  await page.goto(origin+'/?cloud=1#/projects/'+projectId);await page.locator('dialog input[type=password]').fill('browser-pass');await page.locator('dialog [type=submit]').click();await page.waitForFunction(id=>workspace.projects.find(p=>p.id===id)?.entities.length>0,projectId);
  assert.equal(await page.locator('#cloudSignIn').count(),0);
  await page.goto(origin+'/?cloud=1&edit=1#/projects/'+projectId);await page.locator('#cloudSignIn [name=email]').fill('owner@example.invalid');await page.locator('#cloudSignIn [name=password]').fill('fixture-password');await page.locator('#cloudSignIn [type=submit]').click();await page.locator('.project-access-settings').click();
  await page.waitForFunction(()=>!document.querySelector('dialog[open] [type=submit]').disabled);await page.locator('[data-visibility]').selectOption('private');assert.equal(await page.locator('[data-password-label]').isVisible(),false);await page.locator('dialog [type=submit]').click();await page.locator('dialog.access-dialog').waitFor({state:'detached'});
  await page.goto(origin+'/?cloud=1#/library');await page.waitForFunction(()=>typeof workspace!=='undefined'&&workspace?.library);assert.equal(await page.evaluate(id=>workspace.projects.some(p=>p.id===id),projectId),false);assert.equal(await page.evaluate(id=>workspace.library.entities.some(e=>e.id===id),exclusiveId),false);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
