const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createServer} = require('./server.js');
const Projects = require('./projects.js');
const Model = require('./ontology-model.js');

async function fixture(t, options={}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pm-twin-http-'));
  const app = createServer({dbPath:path.join(dir,'ontology.sqlite'),port:0,...options});
  const baseUrl = await app.listen();
  t.after(async () => { await app.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  return baseUrl;
}

test('local API starts with empty Library and projects', async t => {
  const baseUrl = await fixture(t);
  const response = await fetch(baseUrl+'/api/workspace');
  assert.equal(response.status,200);
  const ws = await response.json();
  assert.equal(ws.revision,0);
  assert.deepEqual(ws.projects,[]);
  assert.deepEqual(ws.library.entities,[]);
});

test('local server rejects foreign-origin writes and hidden database paths', async t => {
  const baseUrl = await fixture(t);
  const response = await fetch(baseUrl+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'});
  assert.equal(response.status,403);
  const hidden = await fetch(baseUrl+'/.local-data/ontology.sqlite');
  assert.equal(hidden.status,404);
});

test('HTTP saves a project and rejects a stale revision', async t => {
  const baseUrl = await fixture(t);
  const ws = await (await fetch(baseUrl+'/api/workspace')).json();
  ws.projects.push(Projects.create('LS'));
  const body = JSON.stringify({workspace:ws,scope:null,revision:ws.revision});
  const saved = await fetch(baseUrl+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).projects[0].name,'LS');
  const stale = await fetch(baseUrl+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal(stale.status,409);
});

test('HTTP persists project view settings and exports all ontology data', async t => {
  const baseUrl = await fixture(t);
  let ws = await (await fetch(baseUrl+'/api/workspace')).json();
  const project = Projects.create('LS');
  ws.projects.push(project);
  ws = await (await fetch(baseUrl+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:ws,scope:null,revision:ws.revision})})).json();
  const saved = await fetch(baseUrl+'/api/settings/'+project.id+'/production',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({partId:'G65'})});
  assert.equal(saved.status,200);
  assert.equal((await (await fetch(baseUrl+'/api/workspace')).json()).viewSettings[project.id].production.partId,'G65');
  const backup = await fetch(baseUrl+'/api/export');
  assert.equal(backup.status,200);
  assert.match(backup.headers.get('content-disposition'),/attachment/);
  assert.equal((await backup.json()).projects[0].name,'LS');
});

test('XLSX WIP preview is read-only; approved import saves dated counts', async t => {
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('WIP status');
  sheet.addRow(['Model code','PJT명','ICT(LS)','Packing']);
  sheet.addRow(['X1','G65',12,0]);
  const file=Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
  const baseUrl=await fixture(t),post=(url,value)=>fetch(baseUrl+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  let ws=await (await fetch(baseUrl+'/api/workspace')).json();
  const project=Projects.create('LS');ws.projects.push(project);
  ws=await (await post('/api/workspace',{workspace:ws,scope:null,revision:ws.revision})).json();
  const part=Model.addEntity(ws.projects[0],{type:'Part',name:'G65'});
  ws=await (await post('/api/workspace',{workspace:ws,scope:project.id,revision:ws.revision})).json();
  const input={projectId:project.id,filename:'mes.xlsx',base64:file};
  const preview=await post('/api/wip/preview',input);
  assert.equal(preview.status,200);
  assert.equal((await preview.json()).rows[0].counts[0].quantity,12);
  assert.equal((await (await fetch(baseUrl+'/api/wip?project='+project.id)).json()).snapshots.length,0);
  const saved=await post('/api/wip',{...input,revision:ws.revision,capturedAt:'2026-10-03T14:00:00.000Z',partMappings:{2:part.id}});
  assert.equal(saved.status,200);
  const data=await (await fetch(baseUrl+'/api/wip?project='+project.id)).json();
  assert.equal(data.counts.length,2);
  assert.equal(data.counts[0].partId,part.id);
  assert.deepEqual(data.counts.map(item=>item.quantity),[12,0]);
});

test('ambiguous MES stage stays raw until a valid Part-specific Step is reviewed', async t => {
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('WIP');
  sheet.addRow(['PJT명','ICT','Packing']);sheet.addRow(['G65',0,'']);
  const baseUrl=await fixture(t),post=(url,value)=>fetch(baseUrl+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  let ws=await (await fetch(baseUrl+'/api/workspace')).json();const project=Projects.create('LS');ws.projects.push(project);
  ws=await (await post('/api/workspace',{workspace:ws,scope:null,revision:ws.revision})).json();
  const target=ws.projects[0],part=Model.addEntity(target,{type:'Part',name:'G65'}),other=Model.addEntity(target,{type:'Part',name:'T1'});
  const first=Model.addEntity(target,{type:'Production Step',name:'ICT 1',productionStage:'ICT'}),second=Model.addEntity(target,{type:'Production Step',name:'ICT 2',productionStage:'ICT'}),wrong=Model.addEntity(target,{type:'Production Step',name:'Other ICT',productionStage:'ICT'});
  for(const step of [first,second])Model.addRelation(target,{from:step.id,type:'applies_to',to:part.id});
  Model.addRelation(target,{from:wrong.id,type:'applies_to',to:other.id});
  ws=await (await post('/api/workspace',{workspace:ws,scope:project.id,revision:ws.revision})).json();
  const input={projectId:project.id,filename:'mes.xlsx',base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),capturedAt:'2026-10-03T14:00:00.000Z',partMappings:{2:part.id}};
  const bad=await post('/api/wip',{...input,revision:ws.revision,stepMappings:{[part.id+':2']:wrong.id}});
  assert.equal(bad.status,400);
  assert.equal((await (await fetch(baseUrl+'/api/wip?project='+project.id)).json()).snapshots.length,0);
  const saved=await post('/api/wip',{...input,revision:ws.revision,stepMappings:{[part.id+':2']:first.id}});
  assert.equal(saved.status,200);
  let data=await (await fetch(baseUrl+'/api/wip?project='+project.id)).json();
  assert.equal(data.counts.length,1,'Blank Packing is unknown, not zero');
  assert.equal(data.counts[0].quantity,0);
  assert.equal(data.counts[0].stepId,first.id);
  const newRevision=(await saved.json()).revision;
  assert.equal((await post('/api/wip',{...input,revision:newRevision,stepMappings:{[part.id+':2']:''}})).status,200);
  data=await (await fetch(baseUrl+'/api/wip?project='+project.id)).json();
  assert.equal(data.snapshots.length,2);
  assert.equal(data.counts[0].stepId,'','An explicit blank leaves ambiguous count unmapped');
});

test('worker count API records observed staff for a Part', async t => {
  const baseUrl=await fixture(t),post=(url,value)=>fetch(baseUrl+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  let ws=await (await fetch(baseUrl+'/api/workspace')).json(),project=Projects.create('LS');ws.projects.push(project);
  ws=await (await post('/api/workspace',{workspace:ws,scope:null,revision:ws.revision})).json();
  const part=Model.addEntity(ws.projects[0],{type:'Part',name:'G65'});
  ws=await (await post('/api/workspace',{workspace:ws,scope:project.id,revision:ws.revision})).json();
  const response=await post('/api/staffing',{projectId:project.id,revision:ws.revision,partId:part.id,count:8,capturedAt:'2026-10-03T14:00:00.000Z',shift:'A',basis:'observed'});
  assert.equal(response.status,200);
  const data=await (await fetch(baseUrl+'/api/staffing?project='+project.id)).json();
  assert.equal(data[0].count,8);
  assert.equal(data[0].shift,'A');
});

test('production staffing API records a direct machine observation without inferring Step staff', async t => {
  const baseUrl=await fixture(t),post=(url,value)=>fetch(baseUrl+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  let ws=await (await fetch(baseUrl+'/api/workspace')).json();const project=Projects.create('LS');ws.projects.push(project);
  ws=await (await post('/api/workspace',{workspace:ws,scope:null,revision:ws.revision})).json();
  const machine=Model.addEntity(ws.projects[0],{type:'Resource',name:'EOL 1',resourceKind:'machine'});
  ws=await (await post('/api/workspace',{workspace:ws,scope:project.id,revision:ws.revision})).json();
  const response=await post('/api/production-staffing',{projectId:project.id,revision:ws.revision,targetId:machine.id,targetType:'Resource',count:2,capturedAt:'2026-10-03T14:00:00.000Z',shift:'A',basis:'observed'});
  assert.equal(response.status,200);
  const counts=await (await fetch(baseUrl+'/api/production-staffing?project='+project.id)).json();
  assert.equal(counts[0].targetId,machine.id);
  assert.equal(counts[0].count,2);
  assert.equal((await (await fetch(baseUrl+'/api/export')).json()).productionStaffingCounts.length,1);
});

test('HTTP change review can keep or revert latest committed project update', async t => {
  const baseUrl=await fixture(t);
  const post=async (url,body)=>fetch(baseUrl+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let ws=await (await fetch(baseUrl+'/api/workspace')).json();
  const project=Projects.create('LS');ws.projects.push(project);
  ws=await (await post('/api/workspace',{workspace:ws,scope:null,revision:ws.revision})).json();
  Model.addEntity(ws.projects[0],{type:'Part',name:'G65'});
  ws=await (await post('/api/workspace',{workspace:ws,scope:project.id,revision:ws.revision})).json();
  const id=ws.pendingChange.id;
  const history=await (await fetch(baseUrl+'/api/changes?scope='+project.id)).json();
  assert.equal(history.changes[0].id,id);
  const reverted=await post('/api/changes/'+id+'/revert',{revision:ws.revision});
  assert.equal(reverted.status,200);
  ws=await reverted.json();
  assert.equal(ws.projects[0].entities.length,0);
  assert.equal((await post('/api/changes/'+id+'/revert',{revision:ws.revision})).status,409);
});

test('AI extraction stays disabled without a server-side key', async t => {
  const baseUrl = await fixture(t,{openaiKey:''});
  assert.equal((await (await fetch(baseUrl+'/api/health')).json()).aiConfigured,false);
  const response=await fetch(baseUrl+'/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'library',text:'Supplier called.'})});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/AI not configured/);
});

test('AI source stays local until explicit extraction, then returns reviewed draft', async t => {
  const candidate={summary:'Buyer A met Supplier B.',objects:[{candidateId:'c1',suggestedAction:'create',type:'Person',name:'Buyer A',confidence:.9,sourceExcerpt:'Buyer A'}],relationships:[],unresolved:[]};
  const openaiFetch=async (url,request)=>{
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    assert.equal(request.headers.Authorization,'Bearer test-key');
    const body=JSON.parse(request.body);
    assert.equal(body.model,'gpt-6-luna');
    assert.equal(body.response_format.type,'json_object');
    assert.equal(Object.hasOwn(body,'temperature'),false);
    assert.match(body.messages.at(-1).content,/Buyer A met Supplier B/);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(candidate)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const baseUrl=await fixture(t,{openaiKey:'test-key',openaiFetch});
  const before=await (await fetch(baseUrl+'/api/export')).json();
  assert.equal(before.sources.length,0);
  const response=await fetch(baseUrl+'/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'library',text:'Buyer A met Supplier B.'})});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.draft.objects[0].name,'Buyer A');
  assert.ok(result.source.sourceId);
  const backup=await (await fetch(baseUrl+'/api/export')).json();
  assert.equal(backup.sources.length,1);
  assert.equal(backup.ingestionJobs.length,1);
});

test('AI cannot choose a Library ID; ambiguous names are offered for human review', async t => {
  const output={summary:'Notes',objects:[
    {candidateId:'person-a',suggestedAction:'link_existing',matchedObjectId:'invented-id',type:'Person',name:'Buyer A'},
    {candidateId:'person-b',suggestedAction:'link_existing',matchedObjectId:'invented-id',type:'Person',name:'Buyer B'},
    {candidateId:'person-c',suggestedAction:'link_existing',matchedObjectId:'invented-id',type:'Person',name:'Buyer C'}
  ],relationships:[],unresolved:[]};
  const openaiFetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}),{status:200});
  const baseUrl=await fixture(t,{openaiKey:'test-key',openaiFetch});
  let ws=await (await fetch(baseUrl+'/api/workspace')).json();
  const a=Model.addEntity(ws.library,{type:'Person',name:'Buyer A'});
  const b1=Model.addEntity(ws.library,{type:'Person',name:'Buyer B'});
  const b2=Model.addEntity(ws.library,{type:'Person',name:'Buyer B'});
  const c=Model.addEntity(ws.library,{type:'Person',name:'Other person'});
  ws=await (await fetch(baseUrl+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:ws,scope:'library',revision:ws.revision})})).json();
  const response=await fetch(baseUrl+'/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'library',text:'Buyer A, Buyer B and Buyer C met.'})});
  assert.equal(response.status,200);
  const result=(await response.json()).draft.objects;
  assert.equal(result[0].matchedObjectId,a.id);
  assert.equal(result[1].suggestedAction,'create');
  assert.deepEqual(result[1].possibleMatches.map(item=>item.id).sort(),[b1.id,b2.id].sort());
  assert.equal(result[2].suggestedAction,'create');
  assert.equal(result[2].matchedObjectId,undefined);
  assert.notEqual(result[2].matchedObjectId,c.id);
});
