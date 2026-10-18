const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('./ontology-model'),P=require('./projects'),F=require('./final-parts'),G=require('./progress'),H=require('./hourly');
function fixture(){const p=P.create('LS'),base=M.addEntity(p,{type:'Part',name:'LQ2 STD',productionFamily:'LDM'}),step=M.addEntity(p,{type:'Production Step',name:'EOL',productionStage:'EOL'});M.addRelation(p,{type:'applies_to',from:step.id,to:base.id});return {p,base,step};}
test('final IB/OB RH/LH parts keep distinct identities, routes, WIP and hourly quantities',()=>{
 const {p,base,step}=fixture();const children=[];
 for(const inOut of ['IB','OB'])for(const side of ['RH','LH'])children.push(G.registerModel(p,{basePartId:base.id,name:'LQ2 STD '+inOut+' '+side,inOut,side,modelCode:inOut+'-'+side,finalPart:true}));
 assert.equal(F.isFinal(p,base),false);assert.equal(F.list(p).length,4);assert.equal(F.expand(p,[base.id]).length,4);assert.equal(F.label(children[0]),'LQ2 STD IB RH');assert.equal(F.label({...children[0],name:'LQ2 STD'}),'LQ2 STD IB RH');
 const text='model code\tpart name\tEOL\n'+children.map((part,i)=>part.modelCode+'\t'+part.name+'\t'+(i+1)).join('\n');const draft=G.parse(p,text,{capturedAt:'2026-10-17T09:00:00-06:00'});G.validate(p,draft.rows);assert.equal(new Set(draft.rows.map(r=>r.partId)).size,4);assert.deepEqual(G.at(draft.rows,'2026-10-17T10:00:00-06:00').map(r=>r.quantity),[1,2,3,4]);
 const hourly=children.map((part,i)=>H.parseInput(p,{partId:part.id,date:'2026-10-17',text:'9am 100 '+(i+10)})[0]);assert.equal(H.latest(hourly).length,4);assert.equal(H.modelSeries(hourly,children[0].id,'pcs').actual,10);assert.equal(H.modelSeries(hourly,children[1].id,'pcs').actual,11);
 assert.ok(children.every(part=>G.steps(p,part.id).some(s=>s.id===step.id)));
 assert.throws(()=>H.parseInput(p,{partId:base.id,date:'2026-10-17',text:'9am 100 60'}),/최종 파츠/);assert.throws(()=>G.validate(p,[{...draft.rows[0],partId:base.id,code:''}]),/최종 파츠/);
 // Historical model-level observations stay readable, without splitting them into children.
 const old={...hourly[0],partId:base.id,actual:99};assert.equal(H.modelSeries([old,...hourly],base.id,'pcs').actual,99);assert.equal(H.modelSeries([old,...hourly],children[0].id,'pcs').actual,10);
});

const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),browserPath=process.env.CHROME_PATH||'/usr/bin/chromium';
test('browser: final-part selectors, independent saved counts and simple part registration',{skip:!fs.existsSync(browserPath),timeout:45000},async t=>{
 const {openStore}=require('./local-store'),{createServer}=require('./server'),{chromium}=require('playwright-core'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'final-parts-ui-')),file=path.join(dir,'db.sqlite');
 const {p,base}=fixture(),parts=[];for(const inOut of ['IB','OB'])for(const side of ['RH','LH'])parts.push(G.registerModel(p,{basePartId:base.id,name:'LQ2 STD '+inOut+' '+side,inOut,side,modelCode:inOut+'-'+side,finalPart:true}));
 const db=openStore(file);try{let w=db.load();w.projects.push(p);w=db.save(w,null,w.revision);w=db.save({...w,projects:[p]},p.id,w.revision);
  const draft=G.parse(p,'model code\tpart name\tEOL\n'+parts.map((part,i)=>part.modelCode+'\t'+part.name+'\t'+(i+1)).join('\n'),{capturedAt:'2026-10-17T09:00:00-06:00'});
  db.saveProgress({projectId:p.id,revision:w.revision,text:'synthetic four-part WIP',rows:draft.rows});w=db.load();db.hourlySave({projectId:p.id,revision:w.revision,rows:parts.map((part,i)=>H.parseInput(p,{partId:part.id,date:'2026-10-17',text:'9am 100 '+(10+i)})[0])});
 }finally{db.close();}
 const server=createServer({dbPath:file,port:0}),url=await server.listen(),browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox']});
 t.after(async()=>{await browser.close();await server.close();fs.rmSync(dir,{recursive:true,force:true});});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/#/projects/'+p.id);await page.locator('[data-workstream="production"]').click();await page.locator('[data-hourly-toggle]').click();
 await page.waitForFunction(()=>hourlyUI.rows.length===4);assert.equal(await page.locator('[data-hourly-models] input').count(),4);
 await page.locator('[data-hourly-model-label]').click();await page.locator('[data-hourly-part="'+parts[1].id+'"]').check();assert.equal(await page.evaluate(()=>hourlyUI.dayRows()[0].actual),11);
 await page.locator('[data-hourly-input]').click();assert.equal(await page.locator('[data-hourly-input-part] option').count(),4);await page.locator('[data-hourly-input-close]').click();await page.locator('[data-hourly-toggle]').click();
 await page.evaluate(id=>{mapPartIds=[id];mapPartsCustomized=true;render();},parts[0].id);await page.locator('[data-progress-toggle]').click();await page.waitForFunction(()=>progressUI.data.rows.length===4);await page.locator('[data-progress-part]').selectOption(parts[2].id);
 assert.equal(await page.evaluate(()=>progressUI.rows()[0].quantity),3);assert.equal(await page.locator('.progress-badge').count(),1);assert.equal(await page.locator('[data-progress-part] option').count(),4);
 // A real dialog saves a new canonical part and confirmed route through the shared API.
 await page.locator('[data-final-part]:visible').click();await page.locator('[data-base]').selectOption(base.id);await page.locator('[data-inout]').selectOption('IB');await page.locator('[data-side]').selectOption('RH');await page.locator('[data-name]').fill('LQ2 STD IB RH Revision B');await page.locator('[data-code]').fill('SYNTHETIC-REV-B');await page.locator('[data-route]').check();await page.locator('dialog [type=submit]').click();try{await page.waitForFunction(()=>workspace.projects[0].entities.some(p=>p.modelCode==='SYNTHETIC-REV-B'),null,{timeout:5000});}catch{throw Error('Registration failed: '+await page.locator('dialog[open]').innerText()+'; browser errors: '+errors.join(','));}
 await page.reload();await page.locator('[data-workstream="production"]').click();await page.locator('[data-hourly-toggle]').click();await page.waitForFunction(()=>hourlyUI.rows.length===4);assert.equal(await page.locator('[data-hourly-models] input').count(),5);assert.equal(await page.evaluate(()=>hourlyUI.rows.reduce((sum,r)=>sum+r.actual,0)),46);assert.deepEqual(errors,[]);
});

test('named-part migration preserves historical parent counts and is idempotent',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {Client}=require('pg'),{randomUUID}=require('node:crypto'),{applyMigrations}=require('./scripts/supabase-migrations'),{withPostgresStore}=require('./postgres-store');
 const admin=new Client({connectionString:process.env.TEST_DATABASE_URL});await admin.connect();const name='final_migration_'+randomUUID().replaceAll('-',''),dir=fs.mkdtempSync(path.join(os.tmpdir(),'final-migrations-'));let client;
 try{await admin.query('CREATE DATABASE '+name);const url=new URL(process.env.TEST_DATABASE_URL);url.pathname='/'+name;client=new Client({connectionString:url.toString()});await client.connect();
  await client.query("CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE TABLE auth.users(id UUID PRIMARY KEY)");const owner=randomUUID();await client.query('INSERT INTO auth.users VALUES($1)',[owner]);
  const source=path.join(__dirname,'supabase/migrations');for(const file of fs.readdirSync(source))if(!file.startsWith('202610180002_'))fs.copyFileSync(path.join(source,file),path.join(dir,file));
  const query=async sql=>(await client.query(sql)).rows;await applyMigrations(query,dir,()=>{});const {p,base,step}=fixture();let w=await withPostgresStore(client,owner,s=>s.load());w.projects.push(p);w=await withPostgresStore(client,owner,s=>s.save(w,null,w.revision));w=await withPostgresStore(client,owner,s=>s.save({...w,projects:[p]},p.id,w.revision));
  await withPostgresStore(client,owner,s=>s.saveProgress({projectId:p.id,revision:w.revision,text:'Historical aggregate, do not allocate',rows:[{partId:base.id,stepId:step.id,capturedAt:'2026-10-17T09:00:00-06:00',quantity:123,unit:'pcs'}]}));w=await withPostgresStore(client,owner,s=>s.load());
  await applyMigrations(query,source,()=>{});let migrated=await withPostgresStore(client,owner,s=>s.load());const child=migrated.projects[0].entities.find(p=>p.name==='LQ2 STD IB RH');assert.ok(child);assert.equal(child.modelCode,undefined);assert.ok(G.steps(migrated.projects[0],child.id).some(s=>s.id===step.id));assert.equal(F.isFinal(migrated.projects[0],base),false);
  const counts=await withPostgresStore(client,owner,s=>s.listProgress(p.id));assert.equal(counts.rows.length,1);assert.equal(counts.rows[0].partId,base.id);assert.equal(counts.rows[0].quantity,123);assert.equal(migrated.revision,w.revision+1);
  await applyMigrations(query,source,()=>{});assert.equal((await withPostgresStore(client,owner,s=>s.load())).revision,migrated.revision);
 }finally{if(client)await client.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');await admin.end();fs.rmSync(dir,{recursive:true,force:true});}
});
