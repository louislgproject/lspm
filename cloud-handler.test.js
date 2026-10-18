const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCloudHandler}=require('./cloud-handler');
const {openStore}=require('./local-store');
const Projects=require('./projects');

test('Supabase runtime and gateway paths reach public reads and authenticated editor routes',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-cloud-routing-')),store=openStore(path.join(dir,'test.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  let signIns=0;
  const handler=createCloudHandler({allowedOrigins:['https://louiscxcix.github.io'],authenticate:async()=>{signIns++;return {id:'editor'};},withStore:async(id,fn)=>fn(store),withPublicStore:fn=>fn(store)});
  for(const prefix of ['/ontology','/functions/v1/ontology','']){
    const request=(route,options={})=>handler(new Request('https://project.supabase.co'+prefix+'/api/'+route,{...options,headers:{Origin:'https://louiscxcix.github.io',...options.headers}}));
    const health=await request('public/health');assert.equal(health.status,200,'public route under '+prefix);assert.deepEqual(await health.json(),{ok:true,readOnly:true,mapAssistantConfigured:false,copilotConfigured:false});
    assert.equal(health.headers.get('Access-Control-Allow-Origin'),'https://louiscxcix.github.io');
    const workspace=await request('public/workspace');assert.equal(workspace.status,200);assert.deepEqual((await workspace.json()).projects,[]);
    assert.equal((await request('public/workspace',{method:'POST'})).status,405);
    assert.equal((await request('workspace')).status,401);
    assert.equal((await request('workspace',{headers:{Authorization:'Bearer valid'}})).status,200);
  }
  assert.equal(signIns,3);
  for(const pathname of ['/ontology-other/api/public/health','/functions/v1/ontology-other/api/public/health','/other/ontology/api/public/health']){
    assert.equal((await handler(new Request('https://project.supabase.co'+pathname))).status,404);
  }
});

test('cloud API authenticates before data access and restricts origins',async()=>{
  let touched=false;
  const handler=createCloudHandler({allowedOrigins:['https://louiscxcix.github.io'],authenticate:async token=>{if(token!=='valid')throw Error('bad');return {id:'user'};},withStore:async()=>{touched=true;}});
  for(const [headers,status] of [[{},401],[{Authorization:'Bearer invalid'},401],[{Origin:'https://evil.example',Authorization:'Bearer valid'},403]]){
    const response=await handler(new Request('https://project.supabase.co/functions/v1/ontology/api/workspace',{headers}));assert.equal(response.status,status);assert.equal(touched,false);
  }
  const preflight=await handler(new Request('https://project.supabase.co/functions/v1/ontology/api/workspace',{method:'OPTIONS',headers:{Origin:'https://louiscxcix.github.io'}}));
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://louiscxcix.github.io');
  assert.equal(touched,false);
});

test('cloud API serves the existing workspace/save/revert contract over authenticated HTTP',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-cloud-')),store=openStore(path.join(dir,'test.sqlite'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const userId='d629ba18-2539-4274-b8dd-4dd04466a56c';
  const handler=createCloudHandler({allowedOrigins:['https://louiscxcix.github.io'],authenticate:async()=>({id:userId}),withStore:async(id,fn)=>{assert.equal(id,userId);return fn(store);}});
  const request=async (route,method='GET',data)=>handler(new Request('https://project.supabase.co/functions/v1/ontology/api/'+route,{method,headers:{Authorization:'Bearer valid',Origin:'https://louiscxcix.github.io',...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}));
  let response=await request('workspace'),ws=await response.json();assert.equal(response.status,200);assert.equal(ws.projects.length,0);
  ws.projects.push(Projects.create('Online'));
  response=await request('workspace','POST',{workspace:ws,scope:null,revision:ws.revision});assert.equal(response.status,200);ws=await response.json();assert.equal(ws.projects[0].name,'Online');
  response=await request('workspace','POST',{workspace:ws,scope:null,revision:0});assert.equal(response.status,409);
  response=await request('changes/'+ws.pendingChange.id+'/revert','POST',{revision:ws.revision});assert.equal(response.status,200);assert.equal((await response.json()).projects.length,0);
  response=await request('export');assert.equal(response.status,200);assert.equal((await response.json()).format,'pm-process-twin-local');
  response=await request('../index.html');assert.equal(response.status,404);
});


test('authenticated owner mapping uses the server-resolved workspace, ignoring browser owner parameters',async()=>{
 const owner='d629ba18-2539-4274-b8dd-4dd04466a56c';let opened;
 const handler=createCloudHandler({allowedOrigins:[],authenticate:async()=>({id:'authenticated-user',workspaceId:owner}),withStore:async(id,fn)=>{opened=id;return fn({load:async()=>({revision:1,projects:[]})});}});
 const response=await handler(new Request('https://example.supabase.co/ontology/api/workspace?owner_id=untrusted',{headers:{Authorization:'Bearer valid'}}));
 assert.equal(response.status,200);assert.equal(opened,owner);
});

test('migrated map assistant authenticates, requires consent and keeps provider credentials server-side',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-cloud-map-')),store=openStore(path.join(dir,'test.sqlite'));
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});let sent=0;
 const handler=createCloudHandler({allowedOrigins:[],authenticate:async()=>({id:'editor'}),withStore:async(_,fn)=>fn(store),openaiKey:'fixture-provider-secret',openaiFetch:async(url,options)=>{sent++;assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer fixture-provider-secret');assert.equal(JSON.parse(options.body).model,'gpt-6-luna');return Response.json({choices:[{message:{content:JSON.stringify({answer:'No recorded map objects.',objectIds:['invented']})}}]});}});
 const request=(input,authenticated=true)=>handler(new Request('https://example.supabase.co/ontology/api/map-assistant',{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer valid'}:{})},body:JSON.stringify(input)}));
 assert.equal((await request({scopeId:'library',question:'Map?',consent:true},false)).status,401);
 assert.equal((await request({scopeId:'library',question:'Map?'})).status,400);assert.equal(sent,0);
 const before=store.load().revision,response=await request({scopeId:'library',question:'Map?',consent:true}),data=await response.json();assert.equal(response.status,200);assert.deepEqual(data.references,[]);assert.ok(!JSON.stringify(data).includes('fixture-provider-secret'));assert.equal(store.load().revision,before);
});

test('public map assistant uses the published project and the server key',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-public-map-')),store=openStore(path.join(dir,'test.sqlite'));
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let sent='';
 const handler=createCloudHandler({allowedOrigins:[],withPublicStore:fn=>fn(store),openaiKey:'fixture-provider-secret',openaiFetch:async(_url,options)=>{sent=options.body;return Response.json({choices:[{message:{content:JSON.stringify({answer:'기록된 답',objectIds:[]})}}]});}});
 const call=body=>handler(new Request('https://example.supabase.co/ontology/api/public/map-assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 const response=await call({scopeId:'library',question:'누구?',consent:true,entities:[{name:'injected'}]});
 assert.equal(response.status,200);assert.equal((await response.json()).answer,'기록된 답');
 assert.equal(sent.includes('injected'),false);assert.equal(sent.includes('fixture-provider-secret'),false);
 const denied=createCloudHandler({allowedOrigins:[],withPublicStore:fn=>fn(store)});
 assert.equal((await denied(new Request('https://example.supabase.co/ontology/api/public/map-assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scopeId:'library',question:'누구?',consent:true})}))).status,503);
});
