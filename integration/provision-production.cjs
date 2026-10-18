'use strict';
// Runs in the PM repository's existing Actions credential boundary, not the browser.
const fs=require('node:fs');
const crypto=require('node:crypto');
const project='ahzpuefosoajwwgbfhng';
async function main(){
  const token=process.env.SUPABASE_ACCESS_TOKEN;
  const verifier=process.env.PRODUCTION_PASSWORD_VERIFIER;
  if(!token||!/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier||''))throw Error('Missing management authorization or invalid verifier.');
  const fingerprint=crypto.createHash('sha256').update(verifier).digest('hex');
  async function api(route,body){
    const response=await fetch('https://api.supabase.com/v1/projects/'+project+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
    if(!response.ok){let detail='';try{const d=await response.json();detail=typeof d.message==='string'?d.message:typeof d.error==='string'?d.error:'';}catch{}throw Error('Supabase request failed '+response.status+' '+detail.replaceAll(token,'[redacted]').replaceAll(verifier,'[verifier]').slice(0,500));}
    return response.json();
  }
  const query=query=>api('/database/query',{query});
  const before=await query("SELECT (SELECT count(*) FROM pm.projects) AS projects,(SELECT count(*) FROM pm.entities) AS entities,(SELECT count(*) FROM pm.relations) AS relations");
  const schema=fs.readFileSync('integration/production-schema.sql','utf8');
  const create=`DO $role$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lgls_production') THEN
      IF to_regclass('production.meta') IS NULL THEN RAISE EXCEPTION 'Unknown existing production role; refusing rotation'; END IF;
      IF NOT EXISTS (SELECT 1 FROM production.meta WHERE key='credentialFingerprint' AND value='${fingerprint}') THEN RAISE EXCEPTION 'Production credential mismatch; existing access was not changed'; END IF;
    ELSE
      IF to_regnamespace('production') IS NOT NULL THEN RAISE EXCEPTION 'Unknown existing production schema; refusing adoption'; END IF;
      CREATE ROLE lgls_production LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}';
    END IF;
  END $role$;`;
  const grants=`
    GRANT USAGE ON SCHEMA production TO lgls_production;
    GRANT SELECT,INSERT ON production.meta,production.catalog TO lgls_production;
    GRANT SELECT,INSERT,UPDATE,DELETE ON production.uploads TO lgls_production;
    GRANT SELECT,INSERT,UPDATE ON production.reports TO lgls_production;
    GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA production TO lgls_production;
    DO $policies$ DECLARE item TEXT; BEGIN
      FOREACH item IN ARRAY ARRAY['meta','catalog','reports','uploads'] LOOP
        IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='production' AND tablename=item AND policyname='production_server') THEN
          EXECUTE format('CREATE POLICY production_server ON production.%I TO lgls_production USING (true) WITH CHECK (true)',item);
        END IF;
      END LOOP;
    END $policies$;
    INSERT INTO production.meta VALUES ('credentialFingerprint','${fingerprint}') ON CONFLICT DO NOTHING;`;
  await query('BEGIN; SELECT pg_advisory_xact_lock(8766,2);\n'+create+'\n'+schema+'\n'+grants+'\nCOMMIT;');
  const after=await query("SELECT (SELECT count(*) FROM pm.projects) AS projects,(SELECT count(*) FROM pm.entities) AS entities,(SELECT count(*) FROM pm.relations) AS relations");
  console.log(JSON.stringify({productionSchemaReady:true,pmCountsBefore:before,pmCountsAfter:after,role:'lgls_production',sharedProject:project}));
  const poolers=await api('/config/database/pooler');
  console.log(JSON.stringify({poolers:poolers.map(p=>({host:p.db_host,port:p.db_port,database:p.db_name,mode:p.pool_mode,user:p.db_user}))}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
