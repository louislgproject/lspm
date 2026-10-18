'use strict';

function redact(message,token){
  let value=String(message);
  if(token)value=value.replaceAll(token,'[redacted]');
  return value.replace(/\b(?:sbp_|sb_secret_)[A-Za-z0-9_-]+/g,'[redacted]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,'[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted]')
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi,'$1[redacted]')
    .slice(0,2000);
}

function createManagementApi({project,token,fetchImpl=globalThis.fetch}){
  return async (route,options={})=>{
    let response;
    try{
      response=await fetchImpl('https://api.supabase.com/v1/projects/'+project+route,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
    }catch(error){
      throw Error('Supabase '+(options.method||'GET')+' '+route+' could not connect'+(error.cause?.code?' ('+redact(error.cause.code,token)+')':'')+'.');
    }
    const text=await response.text();let payload;
    try{payload=JSON.parse(text);}catch{payload=null;}
    if(!response.ok){
      // Include only diagnostic fields, never full response objects or request headers.
      const detail=payload&&(typeof payload.message==='string'?payload.message:typeof payload.error==='string'?payload.error:typeof payload.error?.message==='string'?payload.error.message:null);
      const fallback=response.status===401?'Authentication rejected. Check the repository SUPABASE_ACCESS_TOKEN secret.':response.status===403?'Access denied. Verify this token has permission for the target Supabase project.':'Supabase did not provide a diagnostic message.';
      throw Error('Supabase '+(options.method||'GET')+' '+route+' failed ('+response.status+'): '+redact(detail||fallback,token));
    }
    if(payload===null&&text.trim())throw Error('Supabase '+route+' returned an unexpected response format.');
    return payload;
  };
}
module.exports={createManagementApi,redact};
