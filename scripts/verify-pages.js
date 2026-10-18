'use strict';
const fs=require('node:fs'),{chromium}=require('playwright-core');
async function verifyPages({url='https://louiscxcix.github.io/lspm/',attempts=12}={}){
 const expected=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').match(/name="pm-ui-source" content="([a-f0-9]+)"/)[1];
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let failure;
 try{for(let attempt=0;attempt<attempts;attempt++){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(url+'?release='+expected+'&check='+Date.now(),{waitUntil:'networkidle',timeout:45000});
   if(await page.locator('meta[name="pm-ui-source"]').getAttribute('content',{timeout:3000})!==expected)throw Error('Pages is serving an earlier frontend version.');
   await page.locator('#projectTypeFilter').waitFor({state:'visible'});
   await page.waitForFunction(()=>window.PUBLIC_READ_ONLY&&typeof workspace!=='undefined'&&workspace.projects.length>0,null,{timeout:20000});
   if(await page.locator('#cloudSignIn').count())throw Error('Public viewing unexpectedly requires login.');
   const pending=await page.evaluate(()=>workspace.projects.find(p=>p.viewPending)?.id||'');
   if(pending){
    await page.locator('a[href="#/projects/'+pending+'"]').click();
    await page.locator('dialog input[type=password]').fill('7777777');
    await page.locator('dialog [type=submit]').click();
    await page.waitForFunction(id=>(workspace.projects.find(p=>p.id===id)?.entities.length||0)>0,pending,{timeout:20000});
   }else{
    await page.waitForFunction(()=>workspace.library.entities.length>0,null,{timeout:20000});
   }
   const counts=await page.evaluate(()=>({projects:workspace.projects.length,objects:workspace.library.entities.length,relations:workspace.library.relations.length,pending:workspace.projects.filter(p=>p.viewPending).length}));
   if(!pending){
    await page.locator('.library-link').click();
    await page.locator('#projectTitle').filter({hasText:'Global Library'}).waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelectorAll('#nodeLayer .node').length>0||document.querySelector('#nodeLayer').children.length>0);
   }else{
    await page.locator('#projectTitle').waitFor({state:'visible'});
   }
   if(errors.length)throw Error('Published frontend raised '+errors.length+' browser errors.');
   console.log(JSON.stringify({status:'verified',uiSource:expected,...counts,loginRequired:false}));return;
  }catch(e){failure=e.message;}finally{await context.close();}
  if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,10000));
 }}finally{await browser.close();}
 throw Error('Published Pages browser check failed: '+failure);
}
if(require.main===module)verifyPages().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verifyPages};
