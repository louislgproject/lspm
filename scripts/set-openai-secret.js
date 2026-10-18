'use strict';
const {createManagementApi,redact}=require('./supabase-management');
async function main(){
  const key=process.env.OPENAI_API_KEY?.trim()||'';
  const token=process.env.SUPABASE_ACCESS_TOKEN?.trim()||'';
  if(!key){console.log('OPENAI_API_KEY is not configured. Copilot stays off.');return;}
  if(!token)throw Error('Missing SUPABASE_ACCESS_TOKEN.');
  const api=createManagementApi({project:'ahzpuefosoajwwgbfhng',token});
  await api('/secrets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{name:'OPENAI_API_KEY',value:key}])});
  console.log('OpenAI key stored as a Supabase Edge secret. The value was not printed.');
}
main().catch(error=>{console.error(redact(error.message,process.env.SUPABASE_ACCESS_TOKEN?.trim()));process.exitCode=1;});
