-- Read the independent production app's explicitly uploaded snapshots. No draft,
-- WIP, ontology or original hourly record is modified by this bridge.
CREATE TABLE pm.production_report_models (
 owner_id UUID NOT NULL,project_id TEXT NOT NULL,external_line TEXT NOT NULL,external_model TEXT NOT NULL,part_id TEXT NOT NULL,line_id TEXT NOT NULL,
 PRIMARY KEY(owner_id,project_id,external_line,external_model),
 FOREIGN KEY(owner_id,project_id) REFERENCES pm.projects(owner_id,id),
 FOREIGN KEY(owner_id,part_id) REFERENCES pm.entities(owner_id,id),
 FOREIGN KEY(owner_id,line_id) REFERENCES pm.entities(owner_id,id)
);
ALTER TABLE pm.production_report_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pm.production_report_models FROM PUBLIC,anon,authenticated;
DO $$
DECLARE owner UUID; project TEXT; item RECORD;
BEGIN
 SELECT owner_id INTO owner FROM pm.publication WHERE singleton=true;
 SELECT id INTO project FROM pm.projects WHERE owner_id=owner AND name='LS' AND status='active' ORDER BY rowid LIMIT 1;
 IF project IS NULL THEN RETURN; END IF;
 FOR item IN SELECT * FROM (VALUES
('obj-muw1aumj-obahk','ls-final-bl7m-pe-p-lh','ls-final-bl7m-pe-p-lh','obj-muw1aumj-obahk'),
('tem-line-1','report-tem-bl7m-lh','ls-final-bl7m-pe-p-lh','obj-muw1aumj-obahk'),
('obj-muw1aumj-obahk','ls-final-bl7m-pe-p-rh','ls-final-bl7m-pe-p-rh','obj-muw1aumj-obahk'),
('tem-line-1','report-tem-bl7m-rh','ls-final-bl7m-pe-p-rh','obj-muw1aumj-obahk'),
('obj-muw1aumj-obahk','ls-final-flex-n-gate-biled-lh','ls-final-flex-n-gate-biled-lh','obj-muw1aumj-obahk'),
('obj-muw1aumj-obahk','report-tem-biled-lh','ls-final-flex-n-gate-biled-lh','obj-muw1aumj-obahk'),
('obj-muw1aumj-obahk','ls-final-flex-n-gate-biled-rh','ls-final-flex-n-gate-biled-rh','obj-muw1aumj-obahk'),
('obj-muw1aumj-obahk','report-tem-biled-rh','ls-final-flex-n-gate-biled-rh','obj-muw1aumj-obahk'),
('obj-muw1aume-munsi','ls-g65-cornering-lh','ls-g65-cornering-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-g65-cornering-rh','ls-g65-cornering-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-g65-jewelry-piece-lh','ls-final-g65-jewelry-piece-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-g65-jewelry-lh','ls-final-g65-jewelry-piece-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-g65-jewelry-piece-rh','ls-final-g65-jewelry-piece-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-g65-jewelry-rh','ls-final-g65-jewelry-piece-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','obj-muufiui3-sgotg','obj-muufiui3-sgotg','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','obj-muufiui3-wehtb','obj-muufiui3-wehtb','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-g65-side-marker-lh','ls-g65-side-marker-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-g65-side-marker-rh','ls-g65-side-marker-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','obj-muufiui3-fn0dr','obj-muufiui3-fn0dr','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','obj-muufiui2-mvvq8','obj-muufiui2-mvvq8','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-lwr-opt-lh','ls-final-lq2-lwr-opt-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-lwr-opt-rh','ls-final-lq2-lwr-opt-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-lwr-std-lh','ls-final-lq2-lwr-std-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-lwr-std-rh','ls-final-lq2-lwr-std-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-opt-ib-lh','ls-final-lq2-opt-ib-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-lq2-opt-ib-lh','ls-final-lq2-opt-ib-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-opt-ib-rh','ls-final-lq2-opt-ib-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-lq2-opt-ib-rh','ls-final-lq2-opt-ib-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-opt-ob-lh','ls-final-lq2-opt-ob-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-lq2-opt-ob-lh','ls-final-lq2-opt-ob-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-opt-ob-rh','ls-final-lq2-opt-ob-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-lq2-opt-ob-rh','ls-final-lq2-opt-ob-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-primary-lh','ls-final-lq2-primary-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-lq2-primary-rh','ls-final-lq2-primary-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-lq2-std-ib-lh','ls-lq2-std-ib-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-lq2-std-ib-lh','ls-lq2-std-ib-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-lq2-std-ib-rh','ls-lq2-std-ib-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-lq2-std-ib-rh','ls-lq2-std-ib-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-lq2-std-ob-lh','ls-lq2-std-ob-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-lq2-std-ob-lh','ls-lq2-std-ob-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-lq2-std-ob-rh','ls-lq2-std-ob-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-lq2-std-ob-rh','ls-lq2-std-ob-rh','obj-muw1aume-munsi'),
('obj-muw1aumj-obahk','ls-final-p768-a-2-lh','ls-final-p768-a-2-lh','obj-muw1aumj-obahk'),
('tem-line-2','report-tem-p768-a2-lh','ls-final-p768-a-2-lh','obj-muw1aumj-obahk'),
('obj-muw1aumj-obahk','ls-final-p768-a-2-rh','ls-final-p768-a-2-rh','obj-muw1aumj-obahk'),
('tem-line-2','report-tem-p768-a2-rh','ls-final-p768-a-2-rh','obj-muw1aumj-obahk'),
('obj-muw1aume-munsi','ls-final-t1-2-base-lh','ls-final-t1-2-base-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-t1-2-base-lh','ls-final-t1-2-base-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-t1-2-base-rh','ls-final-t1-2-base-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-t1-2-base-rh','ls-final-t1-2-base-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-t1-2-uplevel-lh','ls-final-t1-2-uplevel-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-t1-2-uplevel-lh','ls-final-t1-2-uplevel-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-final-t1-2-uplevel-rh','ls-final-t1-2-uplevel-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-t1-2-uplevel-rh','ls-final-t1-2-uplevel-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-t1xl-lh','ls-t1xl-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-t1xl-lh','ls-t1xl-lh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-t1xl-rh','ls-t1xl-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','report-t1xl-rh','ls-t1xl-rh','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-part-g65-jewelry','ls-part-g65-jewelry','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-part-lq2-lwr','ls-part-lq2-lwr','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-part-lq2-std','ls-part-lq2-std','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-part-lq2-opt','ls-part-lq2-opt','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-part-lq2-primary','ls-part-lq2-primary','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-part-t1-2-base','ls-part-t1-2-base','obj-muw1aume-munsi'),
('obj-muw1aume-munsi','ls-part-t1-2-uplevel','ls-part-t1-2-uplevel','obj-muw1aume-munsi')
 ) AS v(source_line,source_model,part,line) LOOP
  INSERT INTO pm.production_report_models SELECT owner,project,item.source_line,item.source_model,item.part,item.line
   WHERE EXISTS(SELECT 1 FROM pm.entities WHERE owner_id=owner AND id=item.part AND type='Part')
    AND EXISTS(SELECT 1 FROM pm.entities WHERE owner_id=owner AND id=item.line AND type='Resource');
 END LOOP;
END $$;

CREATE FUNCTION pm.production_report_hourly(target_owner UUID,target_project TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE item RECORD; payload JSONB; row JSONB; report_rows JSONB; result JSONB:='[]';
 start_time TIMESTAMPTZ; end_time TIMESTAMPTZ; quantity_key TEXT; hour_index INTEGER;
BEGIN
 IF to_regclass('production.uploads') IS NULL THEN RETURN result; END IF;
 FOR item IN EXECUTE $query$
  SELECT u.sequence,u.report_id,u.uploaded_at,u.payload_json,m.part_id,m.line_id
   FROM production.uploads u JOIN pm.production_report_models m
    ON m.external_line=u.payload_json::jsonb->>'lineCode' AND m.external_model=u.payload_json::jsonb->>'modelCode'
   JOIN pm.entities e ON e.owner_id=m.owner_id AND e.id=m.part_id
   WHERE m.owner_id=$1 AND m.project_id=$2 AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived'
   ORDER BY u.sequence
 $query$ USING target_owner,target_project LOOP
  -- An invalid or unmapped external report cannot take down the workspace.
  BEGIN
   payload:=item.payload_json::jsonb;report_rows:='[]';hour_index:=0;
   IF payload->>'schemaVersion' IS DISTINCT FROM '1' OR payload->>'reportId' IS DISTINCT FROM item.report_id
    OR coalesce(payload->>'productionDate','') !~ '^\d{4}-\d{2}-\d{2}$' OR payload->>'timezone' IS DISTINCT FROM 'America/Mexico_City' OR coalesce(payload->>'unit','') NOT IN ('pcs','sheets','boxes','pallets')
    OR jsonb_typeof(payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'rows')<>24 THEN CONTINUE; END IF;
   FOR row IN SELECT value FROM jsonb_array_elements(payload->'rows') LOOP
    start_time:=(row->>'start')::timestamptz;end_time:=(row->>'end')::timestamptz;
    IF start_time IS NULL OR end_time IS NULL OR end_time-start_time<>interval '1 hour'
     OR start_time<>(((payload->>'productionDate')::date+time '07:00') AT TIME ZONE 'America/Mexico_City')+hour_index*interval '1 hour' THEN RAISE EXCEPTION 'Invalid report interval'; END IF;
    FOREACH quantity_key IN ARRAY ARRAY['actual','target'] LOOP
     IF row->>quantity_key IS NOT NULL AND (jsonb_typeof(row->quantity_key)<>'number' OR (row->>quantity_key)::numeric<0 OR (row->>quantity_key)::numeric>9007199254740991 OR trunc((row->>quantity_key)::numeric)<>(row->>quantity_key)::numeric) THEN RAISE EXCEPTION 'Invalid report quantity'; END IF;
    END LOOP;
    IF row->>'actual' IS NOT NULL OR row->>'target' IS NOT NULL THEN
     report_rows:=report_rows||jsonb_build_array(jsonb_build_object(
      'id','production-upload:'||item.report_id||':'||hour_index,'measurementKind','model','partId',item.part_id,'lineId',item.line_id,'stepId','','machineId','',
      'start',to_char(start_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(end_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'actual',row->'actual','target',row->'target','unit',payload->>'unit',
      'reasons',CASE WHEN coalesce(row->>'reason','')='' THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('category','other','text',left(row->>'reason',1000),'response','','verification','reported')) END,
      'recordedAt',item.uploaded_at,'recordRevision',item.sequence,'planVersion','production-upload','externalReportId',item.report_id,'externalSequence',item.sequence));
    END IF;
    hour_index:=hour_index+1;
   END LOOP;
   result:=result||report_rows;
  EXCEPTION WHEN data_exception OR raise_exception THEN CONTINUE;
  END;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION pm.production_report_hourly(UUID,TEXT) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION pm.merge_production_hourly(native_rows JSONB,external_rows JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'start',row->>'id'),'[]'::jsonb) FROM (
  SELECT value AS row FROM jsonb_array_elements(native_rows)
  UNION ALL
  SELECT e.value FROM jsonb_array_elements(external_rows) e WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(native_rows) n WHERE n.value->>'measurementKind'='model'
    AND n.value->>'partId'=e.value->>'partId' AND n.value->>'unit'=e.value->>'unit'
    AND (n.value->>'start')::timestamptz<(e.value->>'end')::timestamptz AND (n.value->>'end')::timestamptz>(e.value->>'start')::timestamptz)
 ) records
$$;
REVOKE ALL ON FUNCTION pm.merge_production_hourly(JSONB,JSONB) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pm_report_hourly(project_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE owner UUID:=auth.uid(); native_rows JSONB;
BEGIN
 IF owner IS NULL OR NOT EXISTS(SELECT 1 FROM pm.projects p WHERE p.owner_id=owner AND p.id=project_id) THEN RAISE EXCEPTION 'Unknown project.'; END IF;
 SELECT coalesce(jsonb_agg(r.data_json::jsonb||jsonb_build_object('id',r.id,'recordedAt',r.recorded_at,'recordRevision',r.revision) ORDER BY r.revision,r.id),'[]'::jsonb) INTO native_rows FROM pm.hourly_records r WHERE r.owner_id=owner AND r.project_id=pm_report_hourly.project_id;
 RETURN pm.merge_production_hourly(native_rows,pm.production_report_hourly(owner,project_id));
END $$;
REVOKE ALL ON FUNCTION public.pm_report_hourly(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pm_report_hourly(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.pm_public_production_read(operation TEXT,project_id TEXT DEFAULT '',view_tokens TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE owner UUID; result JSONB;
BEGIN
 SELECT p.owner_id INTO owner FROM pm.publication p WHERE singleton=true;
 IF NOT pm.project_visible(owner,project_id,view_tokens) THEN RAISE EXCEPTION 'Project access required.' USING ERRCODE='42501'; END IF;
 result:=pm.pm_public_production_read(operation,project_id);
 IF operation='hourly' THEN result:=pm.merge_production_hourly(result,pm.production_report_hourly(owner,project_id)); END IF;
 RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
