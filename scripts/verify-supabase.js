'use strict';

async function verifyBackend({baseUrl='https://ahzpuefosoajwwgbfhng.supabase.co',origin='https://louiscxcix.github.io',fetchImpl=globalThis.fetch,attempts=5,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const endpoint=baseUrl+'/functions/v1/ontology/api/health';
  let failure='No response.';
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const response=await fetchImpl(endpoint,{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
      const body=await response.json().catch(()=>({}));
      if(response.status===401&&body.error==='비밀번호를 입력하세요.'){
        if(response.headers.get('Access-Control-Allow-Origin')!==origin)throw Error('The deployed function does not allow the frontend origin.');
        const publicResponse=await fetchImpl(baseUrl+'/functions/v1/ontology/api/public/health',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
        const publicBody=await publicResponse.json().catch(()=>({}));
        if(publicResponse.status!==200||publicBody.ok!==true||publicBody.readOnly!==true){
          const code=publicBody.code||(publicBody.error==='비밀번호를 입력하세요.'?'PUBLIC_ROUTE_REQUIRES_LOGIN':'UNEXPECTED_RESPONSE');
          throw Error('Public workspace check failed: HTTP '+publicResponse.status+', code '+String(code)+', stage '+String(publicBody.stage||'public-health')+'.');
        }
        const workspaceResponse=await fetchImpl(baseUrl+'/functions/v1/ontology/api/public/workspace',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
        const workspace=await workspaceResponse.json().catch(()=>({}));
        if(workspaceResponse.status!==200||!Array.isArray(workspace.projects)||!Array.isArray(workspace.library?.entities)||!Array.isArray(workspace.library?.relations))throw Error('Public workspace data check failed: HTTP '+workspaceResponse.status+'.');
        if(workspace.projects[0])for(const route of ['progress','hourly','sample-preparation']){
          const response=await fetchImpl(baseUrl+'/functions/v1/ontology/api/public/'+route+'?'+new URLSearchParams({project:workspace.projects[0].id}),{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
          const value=await response.json().catch(()=>null);
          if(response.status!==200||(route==='progress'? !Array.isArray(value?.snapshots)||!Array.isArray(value?.rows):!Array.isArray(value)))throw Error('Latest production view '+route+' failed: HTTP '+response.status+'.');
        }
        const preflight=await fetchImpl(endpoint,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type'},signal:AbortSignal.timeout(15000)});
        if(preflight.status!==204||preflight.headers.get('Access-Control-Allow-Origin')!==origin)throw Error('Frontend CORS preflight was rejected.');
        console.log('Public workspace and database reads are ready; private endpoints require authentication.');
        console.log('Authenticated database write verification still requires an editor sign-in.');
        return;
      }
      failure='Expected the application authentication response; received HTTP '+response.status+'.';
    }catch(error){failure=error.message;}
    if(attempt+1<attempts)await pause(2000);
  }
  throw Error('Supabase release check failed: '+failure+' Frontend publication stopped.');
}
if(require.main===module)verifyBackend().catch(error=>{
  console.error(error.message);
  if(process.env.GITHUB_ACTIONS==='true')console.error('::error title=Public workspace check::'+error.message.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
  process.exitCode=1;
});
module.exports={verifyBackend};
