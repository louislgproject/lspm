import postgres from 'npm:postgres@3.4.7';
import {createCloudHandler,withPostgresStore,createPublicDataStore,resolveWorkspaceId} from './app.mjs';

const url=Deno.env.get('SUPABASE_URL')!;
const apiKey=Object.values(JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'))[0] as string || Deno.env.get('SUPABASE_ANON_KEY')!;
const database=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:2,ssl:{rejectUnauthorized:true},idle_timeout:20,connect_timeout:10});
const allowedOrigins=(Deno.env.get('PM_ALLOWED_ORIGINS')||'https://louiscxcix.github.io').split(',').map(value=>value.trim()).filter(Boolean);

Deno.serve(createCloudHandler({
  allowedOrigins,
  withPublicStore:(operation:Function,viewTokens='')=>operation(createPublicDataStore({url,apiKey,viewTokens})),
  geminiKey:Deno.env.get('GEMINI_API_KEY')||'',
  openaiKey:Deno.env.get('OPENAI_API_KEY')||'',
  resolvePublishedOwner:async()=>{
    const rows=await database`SELECT owner_id FROM pm.publication WHERE singleton=true`;
    return rows[0]?.owner_id||'';
  },
  authenticate:async (token:string)=>{
    const response=await fetch(url+'/auth/v1/user',{headers:{apikey:apiKey,Authorization:'Bearer '+token}});
    if(!response.ok)throw Error('Invalid session.');
    const user=await response.json();
    const workspaceId=await resolveWorkspaceId(user,{
      ownerEmail:Deno.env.get('PM_WORKSPACE_OWNER_EMAIL')||'',
      loadPublishedOwner:async()=>{
        const rows=await database`SELECT owner_id FROM pm.publication WHERE singleton=true`;
        return rows[0]?.owner_id;
      }
    });
    return {...user,workspaceId};
  },
  withStore:async (userId:string,operation:Function,options?:{readOnly?:boolean})=>{
    const connection=await database.reserve();
    const client={query:async (text:string,params:unknown[]=[])=>({rows:Array.from(await connection.unsafe(text,params as never[]))})};
    try{return await withPostgresStore(client,userId,operation,options);}
    finally{connection.release();}
  },
  loadWorkspace:async (request?:{summary?:boolean,project?:string})=>{
    if(request?.summary){const rows=await database`SELECT pm.editor_workspace_summary() AS value`;return rows[0]?.value||{};}
    if(request?.project){const rows=await database`SELECT pm.editor_workspace_project(${request.project}) AS value`;return rows[0]?.value||null;}
    const rows=await database`SELECT pm.editor_workspace_parts() AS value`;
    return rows[0]?.value||{};
  }
}));
