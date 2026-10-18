-- Reject incomplete records before any insert or compare-and-swap update.
CREATE OR REPLACE FUNCTION public.pm_ingest_local_history(p_token TEXT,p_batch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target UUID; device TEXT; batch_key TEXT; fingerprint TEXT; cached RECORD; item JSONB; row_data JSONB; entity_data JSONB; prior JSONB; original_entity_type TEXT; original_source RECORD; incoming_bytes BYTEA; incoming_meta JSONB; changed INTEGER:=0; accepted JSONB:='[]'; conflicts JSONB:='[]'; result JSONB; revision INTEGER; record_id TEXT; table_name TEXT;
BEGIN
 IF length(p_token)<32 OR length(p_token)>256 THEN RAISE EXCEPTION 'PUBLISHER_AUTH_REQUIRED'; END IF;
 device:=encode(extensions.digest(p_token,'sha256'),'hex');
 SELECT d.owner_id INTO target FROM pm.publisher_devices d WHERE d.token_hash=device AND d.enabled=true;
 IF target IS NULL THEN RAISE EXCEPTION 'PUBLISHER_AUTH_REQUIRED'; END IF;
 IF jsonb_typeof(p_batch) IS DISTINCT FROM 'object' OR octet_length(p_batch::TEXT)>500000 OR jsonb_typeof(p_batch->'changes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PUBLISH_BATCH'; END IF;
 IF jsonb_array_length(p_batch->'changes')>500 THEN RAISE EXCEPTION 'INVALID_PUBLISH_BATCH'; END IF;
 batch_key:=p_batch->>'key';
 IF batch_key IS NULL OR batch_key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST_KEY'; END IF;
 fingerprint:=encode(extensions.digest((p_batch->'changes')::TEXT,'sha256'),'hex');
 SELECT m.value::INTEGER INTO revision FROM pm.meta m WHERE m.owner_id=target AND m.key='revision' FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'WORKSPACE_NOT_READY'; END IF;
 SELECT b.payload_hash,b.response INTO cached FROM pm.publisher_batches b WHERE b.token_hash=device AND b.request_key=batch_key;
 IF FOUND THEN IF cached.payload_hash<>fingerprint THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED'; END IF; RETURN cached.response; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_batch->'changes') LOOP
  table_name:=item->>'table';row_data:=item->'row';record_id:=item->>'id';prior:=NULL;
  IF jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR record_id='' OR length(record_id)>500 OR jsonb_typeof(row_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_PUBLISH_RECORD'; END IF;
  IF table_name='sources' THEN
   IF row_data->>'id' IS DISTINCT FROM record_id THEN RAISE EXCEPTION 'SOURCE_ID_MISMATCH'; END IF;
   incoming_bytes:=decode(row_data->>'content','base64');incoming_meta:=(row_data->>'metadata_json')::JSONB;
   SELECT s.* INTO original_source FROM pm.sources s WHERE s.owner_id=target AND s.id=record_id;
   IF NOT FOUND THEN
    INSERT INTO pm.sources(owner_id,id,kind,filename,mime_type,content,created_at,metadata_json) VALUES(target,record_id,row_data->>'kind',row_data->>'filename',row_data->>'mime_type',incoming_bytes,row_data->>'created_at',row_data->>'metadata_json');changed:=changed+1;
   ELSIF original_source.content=incoming_bytes AND original_source.metadata_json::JSONB=incoming_meta AND (to_jsonb(original_source)-'owner_id'-'rowid'-'content'-'metadata_json')=(row_data-'content'-'metadata_json') THEN NULL;
   ELSE
    INSERT INTO pm.publisher_source_versions(owner_id,source_id,version_hash,incoming_row)
      VALUES(target,record_id,encode(extensions.digest(row_data::TEXT,'sha256'),'hex'),row_data) ON CONFLICT DO NOTHING;
    -- Credential-redacted copies are retained as explicit variants, never replacements.
    IF incoming_meta->'supabasePublication'->>'originalContentSha256'=encode(extensions.digest(original_source.content,'sha256'),'hex')
      AND incoming_meta->'supabasePublication'->>'publishedContentSha256'=encode(extensions.digest(incoming_bytes,'sha256'),'hex')
      AND incoming_meta->'supabasePublication'->>'originalMetadataSha256'=encode(extensions.digest(original_source.metadata_json,'sha256'),'hex')
      AND (to_jsonb(original_source)-'owner_id'-'rowid'-'content'-'metadata_json')=(row_data-'content'-'metadata_json') THEN NULL;
    ELSE
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('table',table_name,'id',record_id));
     INSERT INTO pm.publisher_conflicts VALUES(device,batch_key,table_name,record_id,item,now()) ON CONFLICT DO NOTHING;CONTINUE;
    END IF;
   END IF;
  ELSIF table_name='entities' THEN
   IF jsonb_typeof(row_data->'data_json') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_ENTITY_RECORD'; END IF;
   entity_data:=(row_data->>'data_json')::JSONB;
   IF jsonb_typeof(entity_data) IS DISTINCT FROM 'object'
    OR jsonb_typeof(row_data->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(row_data->'type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(entity_data->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(entity_data->'type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(entity_data->'name') IS DISTINCT FROM 'string'
    OR jsonb_typeof(entity_data->'status') IS DISTINCT FROM 'string'
    OR btrim(entity_data->>'name')=''
    OR (entity_data->>'status') !~ '^[a-z_]+$'
    OR NOT (row_data->>'type'=ANY(ARRAY['Project','Build','Part Revision','Work Item','Production Step','Gate','Deliverable','Characteristic','Person','Organization','Assignment','Event','Evidence','Part','Requirement','Risk','Issue','Resource','Decision']))
    THEN RAISE EXCEPTION 'INVALID_ENTITY_RECORD'; END IF;
   IF row_data->>'id' IS DISTINCT FROM record_id OR entity_data->>'id' IS DISTINCT FROM record_id OR entity_data->>'type' IS DISTINCT FROM row_data->>'type' THEN RAISE EXCEPTION 'ENTITY_ID_MISMATCH'; END IF;
   SELECT e.type,e.data_json::JSONB INTO original_entity_type,prior FROM pm.entities e WHERE e.owner_id=target AND e.id=record_id;
   IF NOT FOUND THEN
    INSERT INTO pm.entities(owner_id,id,type,data_json) VALUES(target,record_id,row_data->>'type',row_data->>'data_json');changed:=changed+1;
   ELSIF prior=(row_data->>'data_json')::JSONB THEN NULL;
   ELSIF row_data->>'type' IN ('Event','Evidence','Person','Organization') AND original_entity_type=row_data->>'type' AND prior->>'type'=original_entity_type AND item->'before' IS NOT NULL AND (item->'before'->>'data_json')::JSONB=prior THEN
    UPDATE pm.entities SET data_json=row_data->>'data_json' WHERE owner_id=target AND id=record_id;changed:=changed+1;
   ELSE
    conflicts:=conflicts||jsonb_build_array(jsonb_build_object('table',table_name,'id',record_id));
    INSERT INTO pm.publisher_conflicts VALUES(device,batch_key,table_name,record_id,item,now()) ON CONFLICT DO NOTHING;CONTINUE;
   END IF;
  ELSIF table_name='relations' THEN
   IF row_data->>'id' IS DISTINCT FROM record_id THEN RAISE EXCEPTION 'RELATION_ID_MISMATCH'; END IF;
   SELECT r.data_json::JSONB INTO prior FROM pm.relations r WHERE r.owner_id=target AND r.id=record_id;
   IF FOUND AND prior<>(row_data->>'data_json')::JSONB THEN
    conflicts:=conflicts||jsonb_build_array(jsonb_build_object('table',table_name,'id',record_id));
    INSERT INTO pm.publisher_conflicts VALUES(device,batch_key,table_name,record_id,item,now()) ON CONFLICT DO NOTHING;CONTINUE;
   END IF;
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json) VALUES(target,record_id,row_data->>'type',row_data->>'from_id',row_data->>'to_id',row_data->>'scope_project_id',row_data->>'data_json') ON CONFLICT DO NOTHING;
   IF FOUND THEN changed:=changed+1; END IF;
  ELSIF table_name='project_memberships' THEN
   INSERT INTO pm.project_memberships(owner_id,project_id,entity_id) VALUES(target,row_data->>'project_id',row_data->>'entity_id') ON CONFLICT DO NOTHING;
   IF FOUND THEN changed:=changed+1; END IF;
  ELSE RAISE EXCEPTION 'PUBLISH_TABLE_NOT_ALLOWED';
  END IF;
  accepted:=accepted||jsonb_build_array(jsonb_build_object('table',table_name,'id',record_id));
 END LOOP;
 IF changed>0 THEN revision:=revision+1;UPDATE pm.meta SET value=revision::TEXT WHERE owner_id=target AND key='revision'; END IF;
 result:=jsonb_build_object('revision',revision,'changed',changed,'accepted',accepted,'conflicts',conflicts);
 INSERT INTO pm.publisher_batches VALUES(device,batch_key,fingerprint,result,now());
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pm_ingest_local_history(TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pm_ingest_local_history(TEXT,JSONB) TO anon,authenticated;

NOTIFY pgrst,'reload schema';
