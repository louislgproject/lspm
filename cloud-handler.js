'use strict';
const {Buffer}=require('node:buffer');
const {createRequestHandler}=require('./server');
const {importBackup}=require('./import-backup');
const MAX_BODY=16_000_000;
async function bodyBytes(request){
  const chunks=[];let size=0;
  if(request.body)for await(const chunk of request.body){size+=chunk.length;if(size>MAX_BODY)throw Error('Request exceeds 16 MB.');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}

function createCloudHandler({authenticate,withStore,withPublicStore,allowedOrigins,geminiKey='',geminiFetch=globalThis.fetch,openaiKey='',openaiFetch=globalThis.fetch,resolvePublishedOwner}){
  const origins=new Set(allowedOrigins);
  return async request=>{
    const origin=request.headers.get('origin');
    const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'});
    const respond=(status,value)=>new Response(JSON.stringify(value),{status,headers});
    if(origin&&!origins.has(origin))return respond(403,{error:'Origin not allowed.'});
    if(origin){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-project-access,x-edit-password');headers.set('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');}
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    const url=new URL(request.url);
    // Supabase's gateway strips /functions/v1 before forwarding to the runtime.
    // Keep both forms for hosted requests and direct gateway-path tests.
    const pathname=url.pathname.replace(/^\/(?:functions\/v1\/)?ontology(?=\/|$)/,'');
    if(!pathname.startsWith('/api/'))return respond(404,{error:'Not found.'});
    if(pathname.startsWith('/api/public/')){
      if(pathname==='/api/public/unlock'&&request.method==='POST'){
        try{const input=JSON.parse((await bodyBytes(request)).toString());
          if(typeof input.projectId!=='string'||typeof input.password!=='string'||input.password.length>72)return respond(400,{error:'Check the project and password.'});
          return await withPublicStore(async store=>{const result=await store.unlock(input.projectId,input.password);return respond(result.error?403:200,result);});
        }catch{return respond(400,{error:'Unable to unlock this project.'});}
      }
      if(pathname==='/api/public/map-assistant'&&request.method==='POST'){
        let input;try{input=JSON.parse((await bodyBytes(request)).toString());}catch{return respond(400,{error:'질문을 확인해 주세요.'});}
        if(input.consent!==true||typeof input.scopeId!=='string'||typeof input.question!=='string')return respond(400,{error:'질문을 확인해 주세요.'});
        if(!withPublicStore||!openaiKey)return respond(503,{error:'연결되지 않았습니다.'});
        try{return await withPublicStore(async store=>{
          const workspace=await store.load(),source=input.scopeId==='library'?workspace.library:(workspace.projects||[]).find(project=>project.id===input.scopeId);
          if(!source)return respond(404,{error:'프로젝트를 찾지 못했습니다.'});
          const privateIds=new Set((source.entities||[]).filter(entity=>entity.privacy==='local_only').map(entity=>entity.id));
          const scope={id:source.id,name:source.name,entities:(source.entities||[]).filter(entity=>!privateIds.has(entity.id)).map(({rawLog,sourceExcerpt,...entity})=>entity),relations:(source.relations||[]).filter(relation=>!privateIds.has(relation.from)&&!privateIds.has(relation.to)).map(({sourceExcerpt,...relation})=>relation)};
          try{return respond(200,await require('./map-assistant-server').answer({scope,input:{question:input.question,history:input.history,visibleIds:null,consent:true},key:openaiKey,fetchImpl:openaiFetch}));}
          catch(error){return respond(error.status||502,{error:error.message||'응답하지 못했습니다.'});}
        },request.headers.get('x-project-access')||'');}catch{return respond(503,{error:'응답하지 못했습니다.'});}
      }
      if(request.method!=='GET')return respond(405,{error:'Public workspace is read-only.'});
      if(!withPublicStore)return respond(503,{error:'Public workspace is not configured.'});
      const route=pathname.slice('/api/public/'.length);
      if(!['health','workspace','wip','staffing','production-staffing','progress','hourly','sample-preparation'].includes(route))return respond(404,{error:'Not found.'});
      try{return await withPublicStore(async store=>{
        if(route==='health'){if(store.health)await store.health();else await store.load();return respond(200,{ok:true,readOnly:true,mapAssistantConfigured:Boolean(openaiKey),copilotConfigured:Boolean(openaiKey)});}
        if(route==='workspace'){
          const workspace=await store.load();workspace.pendingChange=null;
          const privateIds=new Set([workspace.library,...workspace.projects].flatMap(graph=>graph.entities.filter(e=>e.privacy==='local_only').map(e=>e.id)));
          for(const graph of [workspace.library,...workspace.projects]){
            graph.entities=graph.entities.filter(e=>!privateIds.has(e.id));
            graph.relations=graph.relations.filter(r=>!privateIds.has(r.from)&&!privateIds.has(r.to));
            if(graph.workstreams)for(const id of privateIds)delete graph.workstreams[id];
            graph.changes=[];
            for(const entity of graph.entities){delete entity.rawLog;delete entity.sourceExcerpt;}
            for(const relation of graph.relations)delete relation.sourceExcerpt;
          }
          return respond(200,workspace);
        }
        const project=url.searchParams.get('project')||'';
        if(route==='wip')return respond(200,await store.listWip(project,url.searchParams.get('snapshot')||''));
        if(route==='staffing')return respond(200,await store.listStaffing(project));
        if(route==='progress')return respond(200,await store.listProgress(project));
        if(route==='hourly')return respond(200,(await store.listHourly(project)).map(({sourceId,...row})=>row));
        if(route==='sample-preparation')return respond(200,(await store.samplePreparationList(project)).map(require('./sample-preparation').sanitize));
        return respond(200,await store.listProductionStaffing(project));
      },request.headers.get('x-project-access')||'');}catch(error){
        const candidate=String(error.code||'PUBLIC_READ_FAILED');
        const code=/^[A-Z0-9_]{1,64}$/.test(candidate)?candidate:'PUBLIC_READ_FAILED';
        return respond(503,{error:'Public workspace is unavailable.',code,stage:error.publicStage==='supabase-data-api'?'supabase-data-api':'public-read'});
      }
    }
    const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    const editPassword=request.headers.get('x-edit-password')||'';
    let user;
    try{
      if(editPassword){
        if(!require('./edit-password').ok(editPassword))return respond(401,{error:'비밀번호가 다릅니다.'});
        if(resolvePublishedOwner){const id=await resolvePublishedOwner();if(!id)return respond(503,{error:'편집할 작업공간을 찾지 못했습니다.'});user={id,workspaceId:id};}
        else user=await authenticate('master');
      }else{
        if(!token)return respond(401,{error:'비밀번호를 입력하세요.'});
        user=await authenticate(token);
      }
    }catch{return respond(401,{error:'비밀번호가 다릅니다.'});}
    if(!user?.id)return respond(401,{error:'비밀번호가 다릅니다.'});
    let bytes;
    try{bytes=await bodyBytes(request);}catch{return respond(413,{error:'Request exceeds 16 MB.'});}
    try{
      return await withStore(user.workspaceId||user.id,async (store,client)=>{
        if(pathname==='/api/project-access'&&client){
          try{
            if(request.method==='GET')return respond(200,(await client.query('SELECT public.pm_get_project_access($1) AS value',[url.searchParams.get('project')||''])).rows[0].value);
            if(request.method==='POST'){
              const input=JSON.parse(bytes.toString());
              if(!['public','password','private'].includes(input.visibility)||typeof input.password!=='string')return respond(400,{error:'Check visibility and password.'});
              await client.query('SELECT public.pm_set_project_access($1,$2,$3)',[input.projectId,input.visibility,input.password]);
              return respond(200,await store.load());
            }
          }catch{const error=Error('Invalid access settings.');error.response=respond(400,{error:'공개 범위와 비밀번호를 확인하세요. 새 비밀번호는 4자 이상, 최대 72바이트입니다.'});throw error;}
        }
        if(pathname==='/api/import'&&request.method==='POST'){
          if(!request.headers.get('content-type')?.startsWith('application/json'))return respond(400,{error:'Use application/json.'});
          return respond(200,await importBackup(store,client,JSON.parse(bytes.toString())));
        }
        let status=200,body='';
        const res={setHeader:(key,value)=>headers.set(key,value),writeHead:(code,values)=>{status=code;for(const [key,value] of Object.entries(values||{}))headers.set(key,value);},end:value=>{body=value||'';}};
        const req={method:request.method,url:pathname+url.search,headers:Object.fromEntries(request.headers),async *[Symbol.asyncIterator](){yield bytes;}};
        await createRequestHandler({store,geminiKey,geminiFetch,openaiKey,openaiFetch})(req,res);
        // The shared HTTP handler reports validation failures as responses. Throw so
        // its outer PostgreSQL transaction rolls back even after a partial write.
        if(status>=400){const error=Error('API request rejected.');error.response=new Response(body,{status,headers});throw error;}
        return new Response(body,{status,headers});
      });
    }catch(error){
      if(error.response)return error.response;
      if(/empty account|Unsupported backup|Missing backup|Invalid backup|Unsupported backup columns|Invalid source/.test(error.message))return respond(400,{error:error.message});
      return respond(500,{error:'Unable to complete the request. No changes were committed.'});
    }
  };
}
module.exports={createCloudHandler};
