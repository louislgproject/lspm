-- Operational cursors and dispositions are private; retained source bytes never change.
CREATE TABLE pm.kakao_messages (
 owner_id UUID NOT NULL, chat_id TEXT NOT NULL, log_id TEXT NOT NULL,
 source_id TEXT NOT NULL, original_hash TEXT NOT NULL,
 disposition TEXT CHECK(disposition IN ('event','source_only','unresolved')),
 reason TEXT, event_ids JSONB NOT NULL DEFAULT '[]', reviewed_at TIMESTAMPTZ,
 PRIMARY KEY(owner_id,chat_id,log_id), UNIQUE(owner_id,source_id),
 FOREIGN KEY(owner_id,source_id) REFERENCES pm.sources(owner_id,id),
 CHECK(chat_id IN ('453981707667079','461913194057523','473535309242980','481868546664117')),
 CHECK(log_id ~ '^[1-9][0-9]{0,24}$'), CHECK(original_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE pm.kakao_reviews (
 owner_id UUID NOT NULL, request_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
 response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,request_key)
);
ALTER TABLE pm.kakao_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm.kakao_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pm.kakao_messages,pm.kakao_reviews FROM PUBLIC,anon,authenticated;

CREATE FUNCTION pm.kakao_owner(p_token TEXT) RETURNS UUID
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target UUID;
BEGIN
 IF p_token IS NULL OR length(p_token)<32 OR length(p_token)>256 THEN RAISE EXCEPTION 'PUBLISHER_AUTH_REQUIRED'; END IF;
 SELECT d.owner_id INTO target FROM pm.publisher_devices d
 JOIN pm.publication p ON p.singleton=true AND p.owner_id=d.owner_id
 WHERE d.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND d.enabled=true;
 IF target IS NULL THEN RAISE EXCEPTION 'PUBLISHER_AUTH_REQUIRED'; END IF;
 RETURN target;
END $$;

CREATE FUNCTION pm.kakao_seed(target UUID) RETURNS VOID
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 -- Historical unresolved reviews used pending_review plus reviewDisposition.action.
 WITH raw AS (
  SELECT s.*,s.metadata_json::JSONB m FROM pm.sources s WHERE s.owner_id=target AND s.kind='history'
 ), identified AS (
  SELECT raw.*,coalesce(m->>'roomId',m->>'chatId',split_part(m->>'sourceKey','|',3)) chat,
   coalesce(m->>'externalId',m->>'logId',split_part(m->>'sourceKey','|',4)) log FROM raw
  WHERE m->>'provider'='kakao'
 ), approved AS (
  SELECT DISTINCT ON (chat,log) * FROM identified
  WHERE chat IN ('453981707667079','461913194057523','473535309242980','481868546664117')
   AND log ~ '^[1-9][0-9]{0,24}$'
   AND (m->>'sourceKey' IS NULL OR m->>'sourceKey'=concat('kakao|',coalesce(m->>'account',''),'|',chat,'|',log))
  ORDER BY chat,log,created_at,id
 )
 INSERT INTO pm.kakao_messages(owner_id,chat_id,log_id,source_id,original_hash,disposition,reason,event_ids,reviewed_at)
 SELECT target,chat,log,id,
  coalesce(CASE WHEN m#>>'{supabasePublication,originalContentSha256}' ~ '^[a-f0-9]{64}$' THEN m#>>'{supabasePublication,originalContentSha256}' END,
   CASE WHEN m->>'hash' ~ '^[a-f0-9]{64}$' THEN m->>'hash' END,encode(extensions.digest(content,'sha256'),'hex')),
  CASE WHEN m->>'processingState'='unresolved' OR (nullif(m->>'reviewedAt','') IS NOT NULL AND m#>>'{reviewDisposition,action}'='unresolved') THEN 'unresolved'
   WHEN m->>'processingState' IN ('event','event_saved') THEN 'event'
   WHEN m->>'processingState' IN ('source_only','source_only_saved') THEN 'source_only'
   WHEN nullif(m->>'reviewedAt','') IS NOT NULL THEN
    CASE WHEN m#>>'{reviewDisposition,action}' IN ('event','source_only') THEN m#>>'{reviewDisposition,action}'
     WHEN jsonb_typeof(m->'eventIds')='array' AND m->'eventIds'<>'[]'::JSONB THEN 'event' ELSE 'source_only' END
   ELSE NULL END,
  m#>>'{reviewDisposition,reason}',CASE WHEN jsonb_typeof(m->'eventIds')='array' THEN m->'eventIds' ELSE '[]'::JSONB END,
  CASE WHEN nullif(m->>'reviewedAt','') IS NOT NULL THEN (m->>'reviewedAt')::TIMESTAMPTZ END
 FROM approved ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION pm.kakao_checkpoints(target UUID) RETURNS JSONB
LANGUAGE sql SET search_path='' AS $$
 SELECT jsonb_object_agg(c.chat,coalesce((SELECT max(m.log_id::NUMERIC)::TEXT FROM pm.kakao_messages m WHERE m.owner_id=target AND m.chat_id=c.chat),'0'))
 FROM unnest(ARRAY['453981707667079','461913194057523','473535309242980','481868546664117']) c(chat)
$$;
REVOKE ALL ON FUNCTION pm.kakao_owner(TEXT),pm.kakao_seed(UUID),pm.kakao_checkpoints(UUID) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pm_kakao_context(p_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target UUID:=pm.kakao_owner(p_token); revision INTEGER; pending JSONB; unresolved JSONB;
BEGIN
 SELECT m.value::INTEGER INTO revision FROM pm.meta m WHERE m.owner_id=target AND m.key='revision' FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'WORKSPACE_NOT_READY'; END IF;
 PERFORM pm.kakao_seed(target);
 WITH sources AS (
  SELECT k.disposition,k.chat_id,k.log_id,jsonb_build_object('sourceId',s.id,
   'text',CASE WHEN coalesce(s.metadata_json::JSONB->>'sourceType',s.metadata_json::JSONB->>'type')='51' THEN NULL ELSE convert_from(s.content,'UTF8') END,
   'metadata',s.metadata_json::JSONB||jsonb_build_object('time',coalesce(s.metadata_json::JSONB->'time',s.metadata_json::JSONB->'sentAt'),
    'authorId',coalesce(s.metadata_json::JSONB->>'senderId',s.metadata_json::JSONB->>'authorId'),
    'sender',coalesce(s.metadata_json::JSONB->>'senderName',s.metadata_json::JSONB->>'sender'),
    'roomName',CASE k.chat_id WHEN '453981707667079' THEN 'LS Production 1' WHEN '461913194057523' THEN 'SMT'
     WHEN '473535309242980' THEN 'NEXLIDE MQ' WHEN '481868546664117' THEN '이노텍 이정호 개발팀 1:1' END),
   'disposition',k.disposition,'reason',k.reason,'eventIds',k.event_ids,'reviewedAt',k.reviewed_at) item
  FROM pm.kakao_messages k JOIN pm.sources s ON s.owner_id=k.owner_id AND s.id=k.source_id
  WHERE k.owner_id=target AND (k.disposition IS NULL OR k.disposition='unresolved')
 ) SELECT coalesce(jsonb_agg(item ORDER BY chat_id,log_id::NUMERIC) FILTER(WHERE disposition IS NULL),'[]'::JSONB),
  coalesce(jsonb_agg(item ORDER BY chat_id,log_id::NUMERIC) FILTER(WHERE disposition='unresolved'),'[]'::JSONB)
 INTO pending,unresolved FROM sources;
 RETURN jsonb_build_object('checkpoints',pm.kakao_checkpoints(target),'pending',pending,'unresolved',unresolved,
  'graph',jsonb_build_object(
   'entities',coalesce((SELECT jsonb_agg(e.data_json::JSONB-'rawLog'-'sourceExcerpt' ORDER BY e.id) FROM pm.entities e WHERE e.owner_id=target),'[]'::JSONB),
   'relations',coalesce((SELECT jsonb_agg(r.data_json::JSONB-'sourceExcerpt' ORDER BY r.id) FROM pm.relations r WHERE r.owner_id=target),'[]'::JSONB)),
  'projects',coalesce((SELECT jsonb_agg(to_jsonb(p)-'owner_id'-'rowid' ORDER BY p.id) FROM pm.projects p WHERE p.owner_id=target),'[]'::JSONB),
  'revision',revision,'fetchedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;

CREATE FUNCTION public.pm_kakao_collect(p_token TEXT,p_messages JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target UUID:=pm.kakao_owner(p_token); revision INTEGER; item JSONB; prior RECORD; metadata JSONB;
 chat TEXT; log TEXT; source_id TEXT; incoming_hash TEXT; added INTEGER:=0; duplicates INTEGER:=0;
BEGIN
 IF jsonb_typeof(p_messages) IS DISTINCT FROM 'array' OR octet_length(p_messages::TEXT)>2000000 THEN RAISE EXCEPTION 'INVALID_KAKAO_MESSAGES'; END IF;
 IF jsonb_array_length(p_messages)>100 THEN RAISE EXCEPTION 'INVALID_KAKAO_MESSAGES'; END IF;
 SELECT m.value::INTEGER INTO revision FROM pm.meta m WHERE m.owner_id=target AND m.key='revision' FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'WORKSPACE_NOT_READY'; END IF;
 PERFORM pm.kakao_seed(target);
 FOR item IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object'
   OR jsonb_typeof(item->'chatId') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'logId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'authorId') IS DISTINCT FROM 'string' OR (item->>'authorId') !~ '^[0-9]{1,25}$'
   OR jsonb_typeof(item->'sender') IS DISTINCT FROM 'string' OR length(item->>'sender')>500
   OR jsonb_typeof(item->'senderNameCandidates') IS DISTINCT FROM 'array'
   OR jsonb_typeof(item->'time') IS DISTINCT FROM 'string' OR (item->>'time') !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$'
   OR jsonb_typeof(item->'type') IS DISTINCT FROM 'number' OR (item->>'type') !~ '^[0-9]{1,5}$'
   OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'originalHash') IS DISTINCT FROM 'string' OR (item->>'originalHash') !~ '^[a-f0-9]{64}$'
   THEN RAISE EXCEPTION 'INVALID_KAKAO_MESSAGE'; END IF;
  IF jsonb_array_length(item->'senderNameCandidates') NOT BETWEEN 1 AND 100
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'senderNameCandidates') n WHERE jsonb_typeof(n) IS DISTINCT FROM 'string' OR length(n#>>'{}')>500)
   THEN RAISE EXCEPTION 'INVALID_KAKAO_MESSAGE'; END IF;
  chat:=item->>'chatId';log:=item->>'logId';incoming_hash:=item->>'originalHash';
  IF chat NOT IN ('453981707667079','461913194057523','473535309242980','481868546664117') THEN RAISE EXCEPTION 'KAKAO_ROOM_NOT_ALLOWED'; END IF;
  IF log !~ '^[1-9][0-9]{0,24}$' THEN RAISE EXCEPTION 'INVALID_KAKAO_MESSAGE_ID'; END IF;
  IF chat='481868546664117' AND item->>'authorId' NOT IN ('3389141','55304262') THEN RAISE EXCEPTION 'KAKAO_DM_AUTHOR_NOT_ALLOWED'; END IF;
  PERFORM (item->>'time')::TIMESTAMPTZ;
  SELECT k.*,s.content,s.metadata_json::JSONB m INTO prior FROM pm.kakao_messages k
   JOIN pm.sources s ON s.owner_id=k.owner_id AND s.id=k.source_id
   WHERE k.owner_id=target AND k.chat_id=chat AND k.log_id=log;
  IF FOUND THEN
   IF NOT (incoming_hash=prior.original_hash OR incoming_hash=coalesce(prior.m->>'hash','')
    OR incoming_hash=encode(extensions.digest(prior.content,'sha256'),'hex')
    OR incoming_hash=coalesce(prior.m#>>'{supabasePublication,originalContentSha256}','')
    OR incoming_hash=coalesce(prior.m->>'originalContentSha256',''))
    OR coalesce(prior.m->>'senderId',prior.m->>'authorId',item->>'authorId') IS DISTINCT FROM item->>'authorId'
    OR coalesce(prior.m->>'sourceType',prior.m->>'type',item->>'type') IS DISTINCT FROM item->>'type'
    OR (coalesce(prior.m->>'sentAt',prior.m->>'time',item->>'time'))::TIMESTAMPTZ IS DISTINCT FROM (item->>'time')::TIMESTAMPTZ
    THEN RAISE EXCEPTION 'KAKAO_ORIGINAL_CONFLICT'; END IF;
   duplicates:=duplicates+1;CONTINUE;
  END IF;
  source_id:='kakao-source-'||encode(extensions.digest(chat||'|'||log,'sha256'),'hex');
  metadata:=jsonb_build_object('provider','kakao','account','local-kakao','scope','library','privacy','local_only',
   'roomId',chat,'chatId',chat,'externalId',log,'logId',log,'senderId',item->'authorId','authorId',item->'authorId',
   'senderName',item->'sender','sender',item->'sender',
   'roomName',CASE chat WHEN '453981707667079' THEN 'LS Production 1' WHEN '461913194057523' THEN 'SMT'
    WHEN '473535309242980' THEN 'NEXLIDE MQ' WHEN '481868546664117' THEN '이노텍 이정호 개발팀 1:1' END,
   'senderNameCandidates',item->'senderNameCandidates','sentAt',item->'time','time',item->'time','recordedAt',clock_timestamp(),
   'sourceType',item->'type','hash',incoming_hash,'sourceKey','kakao|local-kakao|'||chat||'|'||log,'processingState','pending_review',
   'attachmentInspection',CASE WHEN item->>'type' IN ('2','27') THEN 'not_inspected' ELSE 'not_applicable' END);
  IF incoming_hash<>encode(extensions.digest(item->>'text','sha256'),'hex') THEN
   metadata:=metadata||jsonb_build_object('supabasePublication',jsonb_build_object('redacted',true,'originalContentSha256',incoming_hash,
    'publishedContentSha256',encode(extensions.digest(item->>'text','sha256'),'hex')));
  END IF;
  INSERT INTO pm.sources(owner_id,id,kind,filename,mime_type,content,created_at,metadata_json)
   VALUES(target,source_id,'history','Kakao '||chat||' · '||log,'text/plain',convert_to(item->>'text','UTF8'),clock_timestamp()::TEXT,metadata::TEXT);
  INSERT INTO pm.kakao_messages(owner_id,chat_id,log_id,source_id,original_hash) VALUES(target,chat,log,source_id,incoming_hash);
  added:=added+1;
 END LOOP;
 IF added>0 THEN UPDATE pm.meta SET value=(revision+1)::TEXT WHERE owner_id=target AND key='revision'; END IF;
 RETURN jsonb_build_object('added',added,'duplicates',duplicates,'checkpoints',pm.kakao_checkpoints(target));
END $$;

CREATE FUNCTION public.pm_kakao_review(p_token TEXT,p_review JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<review_state>>
DECLARE target UUID:=pm.kakao_owner(p_token); revision INTEGER; fingerprint TEXT; request_key TEXT; cached RECORD;
 item JSONB; change JSONB; row_data JSONB; data JSONB; record JSONB; scope JSONB; field TEXT; project_id JSONB;
 record_id TEXT; source_id TEXT; new_entities JSONB:='{}'; event_sources JSONB:='{}';
 source_ids TEXT[]:=ARRAY[]::TEXT[]; change_ids TEXT[]:=ARRAY[]::TEXT[];
 from_data JSONB; to_data JSONB; actual JSONB; declared JSONB; result JSONB;
BEGIN
 IF jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR octet_length(p_review::TEXT)>500000
  OR jsonb_typeof(p_review->'key') IS DISTINCT FROM 'string' OR (p_review->>'key') !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(p_review->'items') IS DISTINCT FROM 'array' OR jsonb_typeof(p_review->'changes') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'INVALID_KAKAO_REVIEW'; END IF;
 IF jsonb_array_length(p_review->'items') NOT BETWEEN 1 AND 100 OR jsonb_array_length(p_review->'changes')>500 THEN RAISE EXCEPTION 'INVALID_KAKAO_REVIEW'; END IF;
 request_key:=p_review->>'key';fingerprint:=encode(extensions.digest(p_review::TEXT,'sha256'),'hex');
 SELECT m.value::INTEGER INTO revision FROM pm.meta m WHERE m.owner_id=target AND m.key='revision' FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'WORKSPACE_NOT_READY'; END IF;
 SELECT r.* INTO cached FROM pm.kakao_reviews r WHERE r.owner_id=target AND r.request_key=review_state.request_key;
 IF FOUND THEN
  IF cached.payload_hash<>fingerprint THEN RAISE EXCEPTION 'REQUEST_KEY_REUSED'; END IF;
  RETURN cached.response;
 END IF;
 PERFORM pm.kakao_seed(target);
 FOR item IN SELECT value FROM jsonb_array_elements(p_review->'items') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'sourceId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'disposition') IS DISTINCT FROM 'string' OR item->>'disposition' NOT IN ('event','source_only','unresolved')
   OR jsonb_typeof(item->'reason') IS DISTINCT FROM 'string' OR btrim(item->>'reason')='' OR length(item->>'reason')>5000
   OR jsonb_typeof(item->'eventIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_KAKAO_REVIEW_ITEM'; END IF;
  source_id:=item->>'sourceId';
  IF source_id=ANY(source_ids) THEN RAISE EXCEPTION 'INVALID_KAKAO_DUPLICATE_ITEM'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pm.kakao_messages k WHERE k.owner_id=target AND k.source_id=review_state.source_id) THEN RAISE EXCEPTION 'KAKAO_SOURCE_NOT_ALLOWED'; END IF;
  IF EXISTS(SELECT 1 FROM pm.kakao_messages k WHERE k.owner_id=target AND k.source_id=review_state.source_id AND k.disposition IS NOT NULL) THEN RAISE EXCEPTION 'KAKAO_SOURCE_ALREADY_REVIEWED'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(item->'eventIds') e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string' OR e#>>'{}'='')
   OR (SELECT count(*)<>count(DISTINCT e) FROM jsonb_array_elements(item->'eventIds') e) THEN RAISE EXCEPTION 'INVALID_KAKAO_EVENT_IDS'; END IF;
  source_ids:=array_append(source_ids,source_id);
 END LOOP;
 -- Validate every row before calling the more permissive publisher.
 FOR change IN SELECT value FROM jsonb_array_elements(p_review->'changes') LOOP
  row_data:=change->'row';record_id:=change->>'id';
  IF jsonb_typeof(change) IS DISTINCT FROM 'object' OR jsonb_typeof(change->'id') IS DISTINCT FROM 'string'
   OR record_id='' OR length(record_id)>500 OR jsonb_typeof(row_data) IS DISTINCT FROM 'object'
   OR jsonb_typeof(change->'table') IS DISTINCT FROM 'string' OR change->>'table' NOT IN ('entities','relations')
   OR change ? 'before' OR record_id=ANY(change_ids) OR row_data->>'id' IS DISTINCT FROM record_id
   OR jsonb_typeof(row_data->'data_json') IS DISTINCT FROM 'string'
   OR (row_data ? 'owner_id' AND row_data->>'owner_id' IS DISTINCT FROM target::TEXT)
   THEN RAISE EXCEPTION 'INVALID_KAKAO_CHANGE'; END IF;
  change_ids:=array_append(change_ids,record_id);data:=(row_data->>'data_json')::JSONB;
  IF jsonb_typeof(data) IS DISTINCT FROM 'object' OR jsonb_typeof(data->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(data->'type') IS DISTINCT FROM 'string' OR data->>'id' IS DISTINCT FROM record_id
   OR data->>'type' IS DISTINCT FROM row_data->>'type'
   OR (data ? 'owner_id' AND data->>'owner_id' IS DISTINCT FROM target::TEXT) THEN RAISE EXCEPTION 'INVALID_KAKAO_RECORD'; END IF;
  IF change->>'table'='entities' THEN
   IF row_data->>'type' NOT IN ('Event','Evidence','Person','Organization') OR jsonb_typeof(row_data->'type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(data->'name') IS DISTINCT FROM 'string' OR btrim(data->>'name')=''
    OR jsonb_typeof(data->'status') IS DISTINCT FROM 'string' OR data->>'status' !~ '^[a-z_]+$'
    OR data->>'privacy' IS DISTINCT FROM 'local_only'
    THEN RAISE EXCEPTION 'INVALID_KAKAO_ENTITY'; END IF;
   IF EXISTS(SELECT 1 FROM pm.entities e WHERE e.owner_id=target AND e.id=record_id) THEN RAISE EXCEPTION 'KAKAO_EXISTING_OBJECT'; END IF;
   new_entities:=new_entities||jsonb_build_object(record_id,data);
   IF data->>'type'='Event' THEN
    record:=data->'eventRecord';scope:=record->'scope';
    IF jsonb_typeof(record) IS DISTINCT FROM 'object' OR record->'schemaVersion' IS DISTINCT FROM '1'::JSONB
     OR record->>'recordClass' IS DISTINCT FROM 'business' OR data->>'status'<>'active'
     OR coalesce(record->>'kind','') NOT IN ('disruption','risk','response','resolution','change','request','decision','progress','observation','communication','other')
     OR coalesce(record->>'statementMode','') NOT IN ('reported_fact','observed_fact','requested','planned','decided')
     OR coalesce(record->>'verification','') NOT IN ('reported','verified','disputed')
     OR record->>'lifecycle' IS DISTINCT FROM 'active'
     OR coalesce(record->>'importance','') NOT IN ('normal','attention','critical')
     OR coalesce(record->>'timePrecision','') NOT IN ('exact','date','approximate','unknown')
     OR (record ? 'visibility' AND record->>'visibility' IS DISTINCT FROM 'local_only')
     OR octet_length(record::TEXT)>24000
     OR jsonb_typeof(scope) IS DISTINCT FROM 'object' OR coalesce(scope->>'kind','') NOT IN ('explicit_projects','unassigned')
     OR jsonb_typeof(scope->'projectIds') IS DISTINCT FROM 'array'
     THEN RAISE EXCEPTION 'INVALID_KAKAO_EVENT'; END IF;
    IF (scope->>'kind'='explicit_projects' AND jsonb_array_length(scope->'projectIds')=0)
     OR (scope->>'kind'='unassigned' AND jsonb_array_length(scope->'projectIds')<>0)
     OR (SELECT count(*)<>count(DISTINCT p) FROM jsonb_array_elements(scope->'projectIds') p) THEN RAISE EXCEPTION 'INVALID_KAKAO_SCOPE'; END IF;
    FOR project_id IN SELECT value FROM jsonb_array_elements(scope->'projectIds') LOOP
     IF jsonb_typeof(project_id) IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM pm.projects p WHERE p.owner_id=target AND p.id=project_id#>>'{}' AND p.status='active') THEN RAISE EXCEPTION 'INVALID_KAKAO_SCOPE'; END IF;
    END LOOP;
    FOR field IN SELECT unnest(ARRAY['occurredAt','reportedAt','recordedAt','effectiveAt']) LOOP
     IF record->field IS NOT NULL AND record->field<>'null'::JSONB THEN
      IF jsonb_typeof(record->field) IS DISTINCT FROM 'string' OR (record->>field) !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$' THEN RAISE EXCEPTION 'INVALID_KAKAO_EVENT_TIME'; END IF;
      PERFORM (record->>field)::TIMESTAMPTZ;
     END IF;
    END LOOP;
    IF jsonb_typeof(record->'recordedAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_KAKAO_EVENT_TIME'; END IF;
    IF record ? 'occurredDate' AND record->'occurredDate'<>'null'::JSONB THEN
     IF jsonb_typeof(record->'occurredDate') IS DISTINCT FROM 'string' OR (record->>'occurredDate') !~ '^\d{4}-\d\d-\d\d$' THEN RAISE EXCEPTION 'INVALID_KAKAO_EVENT_DATE'; END IF;
     BEGIN
      PERFORM (record->>'occurredDate')::DATE;
     EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVALID_KAKAO_EVENT_DATE';
     END;
    END IF;
    FOR field IN SELECT unnest(ARRAY['facets','observations','unresolved']) LOOP
     IF record ? field AND record->field<>'null'::JSONB THEN
      IF jsonb_typeof(record->field) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_KAKAO_EVENT'; END IF;
      IF jsonb_array_length(record->field)>100 THEN RAISE EXCEPTION 'INVALID_KAKAO_EVENT'; END IF;
     END IF;
    END LOOP;
   ELSIF data->>'type'='Evidence' THEN
    IF jsonb_typeof(data->'sourceId') IS DISTINCT FROM 'string' OR NOT (data->>'sourceId'=ANY(source_ids)) THEN RAISE EXCEPTION 'KAKAO_EVIDENCE_SOURCE_NOT_ALLOWED'; END IF;
   END IF;
   IF data ? 'sourceEvidenceIds' THEN
    IF jsonb_typeof(data->'sourceEvidenceIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_KAKAO_EVIDENCE_IDS'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(data->'sourceEvidenceIds') s WHERE jsonb_typeof(s) IS DISTINCT FROM 'string' OR NOT(s#>>'{}'=ANY(source_ids))) THEN RAISE EXCEPTION 'KAKAO_EVIDENCE_SOURCE_NOT_ALLOWED'; END IF;
   END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=target AND r.id=record_id) THEN RAISE EXCEPTION 'KAKAO_EXISTING_OBJECT'; END IF;
  END IF;
 END LOOP;
 FOR change IN SELECT value FROM jsonb_array_elements(p_review->'changes') WHERE value->>'table'='relations' LOOP
  row_data:=change->'row';data:=(row_data->>'data_json')::JSONB;
  IF jsonb_typeof(row_data->'from_id') IS DISTINCT FROM 'string' OR jsonb_typeof(row_data->'to_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(data->'from') IS DISTINCT FROM 'string' OR jsonb_typeof(data->'to') IS DISTINCT FROM 'string'
   OR data->>'from' IS DISTINCT FROM row_data->>'from_id' OR data->>'to' IS DISTINCT FROM row_data->>'to_id'
   OR coalesce(row_data->>'type','') NOT IN ('supported_by','reported_by','performed_by','requested_from','records_on','follows_up','supersedes')
   OR (row_data->'scope_project_id' IS NOT NULL AND row_data->'scope_project_id'<>'null'::JSONB AND jsonb_typeof(row_data->'scope_project_id') IS DISTINCT FROM 'string')
   OR data->>'scopeProjectId' IS DISTINCT FROM row_data->>'scope_project_id'
   THEN RAISE EXCEPTION 'INVALID_KAKAO_RELATION'; END IF;
  from_data:=new_entities->(row_data->>'from_id');to_data:=new_entities->(row_data->>'to_id');
  IF to_data IS NULL THEN SELECT e.data_json::JSONB INTO to_data FROM pm.entities e WHERE e.owner_id=target AND e.id=row_data->>'to_id'; END IF;
  IF from_data->>'type' IS DISTINCT FROM 'Event' OR to_data IS NULL THEN RAISE EXCEPTION 'INVALID_KAKAO_RELATION_ENDPOINT'; END IF;
  IF row_data->>'scope_project_id' IS NOT NULL AND NOT(from_data#>'{eventRecord,scope,projectIds}' ? (row_data->>'scope_project_id')) THEN RAISE EXCEPTION 'INVALID_KAKAO_SCOPE'; END IF;
  IF (row_data->>'type'='supported_by' AND (to_data->>'type' IS DISTINCT FROM 'Evidence' OR to_data->>'privacy' IS DISTINCT FROM 'local_only' OR NOT(coalesce(to_data->>'sourceId','')=ANY(source_ids))))
   OR (row_data->>'type'='reported_by' AND to_data->>'type' IS DISTINCT FROM 'Person')
   OR (row_data->>'type' IN ('performed_by','requested_from') AND to_data->>'type' NOT IN ('Person','Organization'))
   OR (row_data->>'type' IN ('follows_up','supersedes') AND to_data->>'type' IS DISTINCT FROM 'Event')
   OR (row_data->>'type'='records_on' AND to_data->>'type' NOT IN ('Work Item','Production Step','Part','Part Revision','Resource','Gate','Risk','Issue','Person','Organization','Build','Deliverable','Requirement','Decision'))
   THEN RAISE EXCEPTION 'INVALID_KAKAO_RELATION_TARGET'; END IF;
  IF row_data->>'type'='supported_by' THEN
   event_sources:=jsonb_set(event_sources,ARRAY[row_data->>'from_id'],coalesce(event_sources->(row_data->>'from_id'),'[]'::JSONB)||jsonb_build_array(to_data->>'sourceId'));
  END IF;
 END LOOP;
 FOR record_id,data IN SELECT key,value FROM jsonb_each(new_entities) LOOP
  IF data->>'type'='Event' THEN
   IF event_sources->record_id IS NULL THEN RAISE EXCEPTION 'KAKAO_EVENT_EVIDENCE_REQUIRED'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_review->'changes') c WHERE c->>'table'='relations' AND c#>>'{row,to_id}'=record_id) THEN
   RAISE EXCEPTION 'KAKAO_UNCONNECTED_HISTORY_OBJECT';
  END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_review->'items') LOOP
  SELECT coalesce(jsonb_agg(e.key ORDER BY e.key),'[]'::JSONB) INTO actual FROM jsonb_each(new_entities) e
   WHERE e.value->>'type'='Event' AND (event_sources->e.key) ? (item->>'sourceId');
  SELECT coalesce(jsonb_agg(e ORDER BY e#>>'{}'),'[]'::JSONB) INTO declared FROM jsonb_array_elements(item->'eventIds') e;
  IF actual<>declared OR (item->>'disposition'='event' AND actual='[]'::JSONB)
   OR (item->>'disposition'<>'event' AND actual<>'[]'::JSONB) THEN RAISE EXCEPTION 'KAKAO_EVENT_IDS_MISMATCH'; END IF;
 END LOOP;
 result:=public.pm_ingest_local_history(p_token,jsonb_build_object('key',request_key,'changes',p_review->'changes'));
 IF result->'conflicts'<>'[]'::JSONB OR (result->>'changed')::INTEGER<>jsonb_array_length(p_review->'changes') THEN RAISE EXCEPTION 'KAKAO_PUBLISH_CONFLICT'; END IF;
 IF (result->>'changed')::INTEGER=0 THEN
  UPDATE pm.meta SET value=(revision+1)::TEXT WHERE owner_id=target AND key='revision';
  result:=result||jsonb_build_object('revision',revision+1);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_review->'items') LOOP
  UPDATE pm.kakao_messages SET disposition=item->>'disposition',reason=item->>'reason',event_ids=item->'eventIds',reviewed_at=clock_timestamp()
   WHERE owner_id=target AND kakao_messages.source_id=item->>'sourceId';
 END LOOP;
 result:=result||jsonb_build_object('reviewed',jsonb_array_length(p_review->'items'));
 INSERT INTO pm.kakao_reviews(owner_id,request_key,payload_hash,response) VALUES(target,request_key,fingerprint,result);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.pm_kakao_context(TEXT),public.pm_kakao_collect(TEXT,JSONB),public.pm_kakao_review(TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pm_kakao_context(TEXT),public.pm_kakao_collect(TEXT,JSONB),public.pm_kakao_review(TEXT,JSONB) TO anon,authenticated;
SELECT pm.kakao_seed(p.owner_id) FROM pm.publication p WHERE p.singleton=true;
NOTIFY pgrst,'reload schema';
