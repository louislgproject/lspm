'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright-core'),{createServer}=require('./server'),{openStore}=require('./local-store'),P=require('./projects'),M=require('./ontology-model');
const chrome=process.env.CHROME_PATH||'/usr/bin/chromium';

test('browser: map drag survives rerenders, saves its actual height, and respects fullscreen',{skip:!fs.existsSync(chrome),timeout:45000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resize-test-')),file=path.join(dir,'db.sqlite'),project=P.create('LS'),part=M.addEntity(project,{type:'Part',name:'Fixture RH',itemKind:'product',side:'RH',productionFamily:'LDM'}),step=M.addEntity(project,{type:'Production Step',name:'EOL',productionStage:'EOL'});
 M.addRelation(project,{from:step.id,to:part.id,type:'applies_to'});project.workstreams={[part.id]:['production'],[step.id]:['production']};
 const db=openStore(file);let w=db.load();w.projects.push(project);w=db.save(w,null,w.revision);db.save({...w,projects:[project]},project.id,w.revision);db.close();
 const server=createServer({dbPath:file,port:0}),url=await server.listen(),browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 t.after(async()=>{await browser.close();await server.close();fs.rmSync(dir,{recursive:true,force:true});});
 for(const readOnly of [false,true])await t.test(readOnly?'public bare map':'editor map with History wrapper',async()=>{
  const context=await browser.newContext({viewport:{width:1280,height:1000}});if(readOnly)await context.addInitScript(()=>window.PUBLIC_READ_ONLY=true);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{await page.goto(url+'/#/projects/'+project.id);await page.locator('[data-workstream="production"]').click();};
  const height=()=>page.evaluate(()=>{const s=document.querySelector('#mapStage');return(s.closest('.event-history-layout')||s).getBoundingClientRect().height;});
  const drag=async(delta,{refresh=false}={})=>{
   const bar=page.locator('.map-resize-bar:visible');await bar.scrollIntoViewIfNeeded();const b=await bar.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2,scroll=await page.evaluate(()=>scrollY);
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+delta/3,{steps:3});
   if(refresh)await page.evaluate(()=>{render();const bar=[...document.querySelectorAll('.map-resize-bar')].find(e=>e.getClientRects().length);bar.parentElement.append(bar);render();});
   await page.mouse.move(x,y+delta,{steps:8});await page.mouse.up();
   assert.ok(Math.abs((await page.evaluate(()=>scrollY))-scroll)<2,'Resizing must not scroll the page');
  };
  await open();const initial=await height();await drag(120,{refresh:true});assert.equal(await height(),initial+120);assert.equal(await page.locator('.map-resize-bar:visible').getAttribute('aria-valuenow'),String(initial+120));assert.equal(await page.evaluate(()=>localStorage.getItem('pm-map-height:mapStage')),String(initial+120));
  await drag(-80);assert.equal(await height(),initial+40);await page.evaluate(()=>render());assert.equal(await height(),initial+40);
  await page.reload();await page.locator('[data-workstream="production"]').click();assert.equal(await height(),initial+40);
  const bar=page.locator('.map-resize-bar:visible');await bar.focus();await page.keyboard.press('ArrowDown');assert.equal(await height(),initial+64);await page.keyboard.press('Home');assert.equal(await height(),240);await page.keyboard.press('Shift+ArrowDown');assert.equal(await height(),320);
  await page.locator('[data-progress-toggle]').click();await page.waitForFunction(()=>progressUI.active);assert.equal(await height(),320);await drag(100,{refresh:true});assert.equal(await height(),420);await page.locator('[data-progress-toggle]').click();assert.equal(await height(),420);
  await page.locator('.map-fullscreen-button:visible').click();await page.waitForFunction(()=>document.body.classList.contains('map-fullscreen-open'));assert.equal(await page.locator('.map-resize-bar:visible').count(),0);assert.ok(await page.locator('#mapStage').evaluate(e=>e.getBoundingClientRect().height)>500,'Fullscreen must fill the available map area');
  await page.evaluate(()=>exitMapFullscreen());await page.waitForFunction(()=>!document.body.classList.contains('map-fullscreen-open'));assert.equal(await height(),420);
  await page.evaluate(()=>{activeTab='Production';selectedWorkstream='';productionMode='Process map';render();});const productionHeight=()=>page.locator('#productionMapStage').evaluate(e=>(e.closest('.event-history-layout')||e).getBoundingClientRect().height);const productionBefore=await productionHeight();await drag(60,{refresh:true});assert.equal(await productionHeight(),productionBefore+60);assert.equal(await page.evaluate(()=>Number(localStorage.getItem('pm-map-height:mapStage'))),420);assert.equal(await page.evaluate(()=>Number(localStorage.getItem('pm-map-height:productionMapStage'))),productionBefore+60);
  assert.deepEqual(errors,[]);await context.close();
 });
});
