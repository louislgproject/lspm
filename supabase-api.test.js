const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const {openStore}=require('./local-store');
const {createCloudHandler}=require('./cloud-handler');
const chrome=process.env.CHROME_PATH||'/usr/bin/chromium';

test('browser: Supabase login, authenticated project saves, reload, export and logout', {skip:!fs.existsSync(chrome)}, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-supabase-browser-'));
  const store=openStore(path.join(dir,'test.sqlite'));
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!/^[a-z.-]+$/.test(name)){res.writeHead(404);res.end();return;}
    const file=path.join(__dirname,name);
    if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const context=await browser.newContext({acceptDownloads:true});
  const cloud=createCloudHandler({allowedOrigins:[base],authenticate:async token=>{if(token!=='master'&&token!=='test-session')throw Error('Unauthorized');return {id:'d629ba18-2539-4274-b8dd-4dd04466a56c'};},withStore:async(_,fn)=>fn(store),withPublicStore:async fn=>fn(store)});
  let refreshes=0,guestReads=0;
  await context.route('https://ahzpuefosoajwwgbfhng.supabase.co/**',async route=>{
    const req=route.request();
    if(req.url().includes('/api/public/')){assert.equal(req.headers().authorization,undefined);guestReads++;}
    if(req.url().includes('/auth/v1/')){
      if(req.url().includes('refresh_token'))refreshes++;
      const body=req.url().includes('/logout')?{}:{access_token:'test-session',refresh_token:'refresh',expires_in:3600,user:{email:'owner@example.com'}};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});return;
    }
    const response=await cloud(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}));
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/?cloud=1&edit=1');
  await page.locator('#cloudSignIn input[name=password]').fill('7777777');
  await page.locator('#cloudSignIn button[type=submit]').click();
  await page.locator('#cloudSignedIn').waitFor({state:'visible'});
  await page.locator('#projectForm').waitFor({state:'visible'});
  await page.locator('#projectName').fill('Supabase project');
  await page.locator('#projectForm button').click();
  await page.waitForFunction(()=>workspace?.projects.some(p=>p.name==='Supabase project'));
  assert.equal(store.load().projects[0].name,'Supabase project');
  await page.reload();
  await page.waitForFunction(()=>workspace?.projects.some(p=>p.name==='Supabase project'));
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportButton').click();
  const download=await downloadPromise;const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(exported.projects[0].name,'Supabase project');
  await page.locator('#cloudSignOut').click();await page.locator('#cloudSignIn').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('pm-edit:ahzpuefosoajwwgbfhng.supabase.co')),null);
  // Latest production views read real persisted records through the public cloud API.
  const M=require('./ontology-model'),S=require('./sample-preparation');
  let w=store.load();const p=w.projects[0];p.projectType='sample';
  const part=M.addEntity(p,{type:'Part',name:'Latest browser model',itemKind:'product'}),step=M.addEntity(p,{type:'Production Step',name:'Latest browser step'});
  M.addRelation(p,{type:'applies_to',from:step.id,to:part.id});p.workstreams={[part.id]:['production'],[step.id]:['production']};
  w=store.save(w,p.id,w.revision);store.featureSave({projectId:p.id,revision:w.revision,features:{wip:true,hourly:true}});w=store.load();
  const date=require('./hourly').productionDay(new Date()),start=date+'T09:00:00-06:00',end=date+'T10:00:00-06:00';
  store.hourlySave({projectId:p.id,revision:w.revision,text:'Private hourly source',rows:[{measurementKind:'model',partId:part.id,unit:'pcs',start,end,actual:80,target:100}]});w=store.load();
  store.saveWip({projectId:p.id,revision:w.revision,capturedAt:new Date(start).toISOString(),filename:'fixture.xlsx',sheet:'WIP',rows:[{row:1,column:2,partName:part.name,partId:part.id,stage:step.name,stepId:step.id,quantity:0}]});w=store.load();
  store.samplePreparationSave({projectId:p.id,revision:w.revision,sheet:S.create(w.projects[0],{partId:part.id,runName:'Latest browser trial'})});
  await page.goto(base+'/?cloud=1');
  await page.waitForFunction(()=>workspace?.projects.some(p=>p.name==='Supabase project'));
  assert.equal(await page.locator('#cloudSignIn').count(),0);
  assert.equal(await page.locator('#projectForm').isVisible(),false);
  assert.equal(await page.locator('#exportButton').isVisible(),false);
  assert.ok(guestReads>=2);
  assert.match(await page.locator('#storageNote').textContent(),/Public workspace/);
  assert.equal(await page.locator('#projectTypeFilter').isVisible(),true);
  await page.locator('#projectList a').first().click();
  await page.locator('[data-workstream="production"]').click();
  await page.locator('[data-hourly-toggle]').click();
  await page.waitForFunction(()=>document.querySelector('[data-hourly-charts]')?.textContent.includes('80'));
  assert.equal(await page.locator('[data-hourly-input]').isVisible(),false);
  await page.locator('[data-hourly-toggle]').click();
  await page.locator('[data-progress-toggle]').click();
  await page.waitForFunction(()=>progressUI.data?.rows.some(row=>row.quantity===0));
  assert.equal(await page.locator('[data-progress-add]').isVisible(),false);
  await page.locator('[data-tab="Risk / Issues"]').click();
  await page.locator('[data-sample-risk="preparation"]').click();
  await page.locator('[data-sample-print]').waitFor({state:'visible'});
  assert.match(await page.locator('#samplePreparationPanel').textContent(),/Latest browser trial/);
  assert.equal(await page.locator('[data-sample-new]').isVisible(),false);
  assert.deepEqual(errors,[]);
});
