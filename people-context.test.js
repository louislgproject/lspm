const {test}=require('node:test'),assert=require('node:assert/strict');
let context;try{context=require('./people-context').peopleContext;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('people context keeps same-name accounts separate and never infers affiliation from names',()=>{
 assert.equal(typeof context,'function');
 const graph={entities:[{id:'p1',type:'Person',name:'LG Innotek Luis',status:'active'},{id:'p2',type:'Person',name:'Luis',status:'active'},{id:'org',type:'Organization',name:'LG Innotek'}],relations:[]};
 const rows=context(graph);assert.equal(rows.length,2);assert.deepEqual(rows[0].affiliations,[]);assert.notEqual(rows[0].id,rows[1].id);
});
test('people context exposes recorded roles and evidence-verified account mapping only',()=>{
 assert.equal(typeof context,'function');
 const graph={entities:[{id:'p',type:'Person',name:'Confirmed person',status:'active',title:'Development contact',department:'Development'},{id:'org',type:'Organization',name:'LG Innotek'},{id:'account',type:'Person',name:'Display alias',status:'active',privacy:'local_only',kakaoAuthorId:'123',identityMatch:{status:'confirmed',personId:'p',authorId:'123',evidenceSourceIds:['s']}}],relations:[{id:'r',type:'member_of',from:'p',to:'org',sourceId:'s'}]};
 const rows=context(graph),person=rows.find(p=>p.id==='p'),account=rows.find(p=>p.id==='account');assert.equal(person.title,'Development contact');assert.equal(person.affiliations[0].name,'LG Innotek');assert.equal(account.canonicalId,'p');
 graph.entities[2].identityMatch.status='candidate';assert.equal(context(graph).find(p=>p.id==='account').canonicalId,undefined);
});

test('final and intermediate parts inherit recorded line contacts without inventing station ownership',()=>{
 const M=require('./ontology-model'),Flow=require('./workflow'),P=require('./projects'),p=P.create('LS');
 const line=M.addEntity(p,{type:'Resource',name:'LDM',resourceKind:'line'}),other=M.addEntity(p,{type:'Resource',name:'TEM',resourceKind:'line'}),final=M.addEntity(p,{type:'Part',name:'G65 Upper RH',itemKind:'product',productionFamily:'LDM'}),component=M.addEntity(p,{type:'Part',name:'G65 Upper RH 1',itemKind:'component',productionFamily:'LDM'}),unknown=M.addEntity(p,{type:'Part',name:'Name mentions LDM',productionFamily:'LDM'}),leader=M.addEntity(p,{type:'Organization',name:'LDM Leaders'}),supervisors=M.addEntity(p,{type:'Organization',name:'LDM Supervisors'}),person=M.addEntity(p,{type:'Person',name:'Recorded Leader'}),manager=M.addEntity(p,{type:'Person',name:'Recorded Line Manager'}),director=M.addEntity(p,{type:'Person',name:'Recorded Director'});
 for(const part of [final,component])M.addRelation(p,{from:line.id,to:part.id,type:'produces',reviewState:'confirmed',basis:'line membership; quantity unknown'});
 for(const group of [leader,supervisors])M.addRelation(p,{from:line.id,to:group.id,type:'escalates_to'});
 M.addRelation(p,{from:person.id,to:leader.id,type:'member_of'});M.addRelation(p,{from:manager.id,to:line.id,type:'manages'});M.addRelation(p,{from:manager.id,to:director.id,type:'reports_to'});
 for(const part of [final,component]){const c=Flow.reportingContacts(p,part.id);assert.equal(c.line.id,line.id);assert.equal(c.firstContacts.length,2);assert.deepEqual(c.laterManagers.map(e=>e.id),[manager.id,director.id]);assert.ok(c.relations.some(r=>r.type==='produces'&&r.to===part.id));}
 const next=M.addEntity(p,{type:'Part',name:'New reviewed final revision',itemKind:'product'});M.addRelation(p,{from:next.id,to:final.id,type:'part_of'});assert.equal(Flow.reportingContacts(p,next.id).line.id,line.id);assert.equal(Flow.reportingContacts(p,unknown.id).status,'unknown');assert.equal(p.relations.some(r=>r.type==='governs'&&r.to===component.id),false);
 const scoped={...p,id:'library',relations:p.relations.map(r=>({...r,scopeProjectId:p.id}))};assert.equal(Flow.reportingContacts(scoped,component.id).line.id,line.id);assert.equal(Flow.reportingContacts({...scoped,id:'unrelated'},component.id).status,'unknown');
 M.addRelation(p,{from:other.id,to:component.id,type:'produces',reviewState:'confirmed'});assert.equal(Flow.reportingContacts(p,component.id).status,'ambiguous');
});
