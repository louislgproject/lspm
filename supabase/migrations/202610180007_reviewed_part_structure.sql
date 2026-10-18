-- Owner review of physical parts, measurement grain and line responsibility.
-- Existing observations, source bytes and router yields are never rewritten.
CREATE FUNCTION pg_temp.review_part(owner UUID, project TEXT, doc JSONB) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE delta INTEGER;
BEGIN
 INSERT INTO pm.entities(owner_id,id,type,data_json) VALUES(owner,doc->>'id',doc->>'type',doc::text)
 ON CONFLICT(owner_id,id) DO UPDATE SET data_json=(pm.entities.data_json::jsonb||doc)::text
 WHERE pm.entities.data_json::jsonb IS DISTINCT FROM pm.entities.data_json::jsonb||doc;
 GET DIAGNOSTICS delta=ROW_COUNT;
 INSERT INTO pm.project_memberships(owner_id,project_id,entity_id) VALUES(owner,project,doc->>'id') ON CONFLICT DO NOTHING;
 INSERT INTO pm.project_workstreams(owner_id,project_id,entity_id,code) VALUES(owner,project,doc->>'id','production') ON CONFLICT DO NOTHING;
 RETURN delta;
END $$;
CREATE FUNCTION pg_temp.review_link(owner UUID, project TEXT, doc JSONB) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE existing_id TEXT; delta INTEGER;
BEGIN
 SELECT r.id INTO existing_id FROM pm.relations r WHERE r.owner_id=owner AND r.type=doc->>'type' AND r.from_id=doc->>'from' AND r.to_id=doc->>'to'
 AND (r.scope_project_id IS NULL OR r.scope_project_id=project)
 AND coalesce(r.data_json::jsonb->>'routePartId','')=coalesce(doc->>'routePartId','') ORDER BY r.rowid LIMIT 1;
 IF existing_id IS NOT NULL THEN doc:=doc||jsonb_build_object('id',existing_id); END IF;
 INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
 VALUES(owner,doc->>'id',doc->>'type',doc->>'from',doc->>'to',project,doc::text)
 ON CONFLICT(owner_id,id) DO UPDATE SET data_json=(pm.relations.data_json::jsonb||doc)::text
 WHERE pm.relations.data_json::jsonb IS DISTINCT FROM pm.relations.data_json::jsonb||doc;
 GET DIAGNOSTICS delta=ROW_COUNT;RETURN delta;
END $$;
DO $$
DECLARE selected_owner UUID; selected_project TEXT; base_id TEXT; line_id TEXT; final_id TEXT; hand TEXT; route RECORD; old RECORD; part RECORD;
 changed INTEGER:=0; affected INTEGER; position_name TEXT; final_name TEXT; integration_id TEXT; piece_id TEXT; piece_name TEXT; piece_number INTEGER; original_name TEXT; assembly_id TEXT; lam_id TEXT;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT id INTO selected_project FROM pm.projects WHERE owner_id=selected_owner AND name='LS' AND status='active' LIMIT 1;
 IF selected_project IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM pm.meta WHERE owner_id=selected_owner AND key='revision' FOR UPDATE;
 SELECT e.id INTO base_id FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
 WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'='LQ2 primary light source' ORDER BY e.rowid LIMIT 1;
 IF base_id IS NOT NULL THEN
  FOR hand IN SELECT unnest(ARRAY['LH','RH']) LOOP
   SELECT e.id INTO final_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Part' AND e.data_json::jsonb->>'name'='LQ2 primary light source '||hand ORDER BY e.rowid LIMIT 1;
   final_id:=coalesce(final_id,'ls-final-lq2-primary-'||lower(hand));
   changed:=changed+pg_temp.review_part(selected_owner,selected_project,jsonb_build_object('id',final_id,'type','Part','name','LQ2 primary light source '||hand,'status','active','itemKind','product','productionFamily','LDM','productFamily','LQ2','side',hand,'mappingState','confirmed','context','Owner review: Primary has LH/RH only; no IB/OB split.'));
   changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-primary-parent-'||final_id,'type','part_of','from',final_id,'to',base_id,'evidence','Owner-confirmed Primary LH/RH classification'));
   FOR route IN SELECT r.from_id FROM pm.relations r JOIN pm.entities e ON e.owner_id=r.owner_id AND e.id=r.from_id WHERE r.owner_id=selected_owner AND r.type='applies_to' AND r.to_id=base_id AND e.type='Production Step' AND (r.scope_project_id IS NULL OR r.scope_project_id=selected_project) LOOP
    changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-primary-route-'||final_id||'-'||route.from_id,'type','applies_to','from',route.from_id,'to',final_id,'evidence','Existing Primary process; corrected final-part classification'));
   END LOOP;
   FOR old IN SELECT e.id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Part' AND e.data_json::jsonb->>'name' IN ('LQ2 primary light source IB '||hand,'LQ2 primary light source OB '||hand) LOOP
    UPDATE pm.entities SET data_json=(data_json::jsonb||jsonb_build_object('status','archived','mappingState','retired_variant','replacedByPartId',final_id))::text WHERE owner_id=selected_owner AND id=old.id AND data_json::jsonb IS DISTINCT FROM data_json::jsonb||jsonb_build_object('status','archived','mappingState','retired_variant','replacedByPartId',final_id);
    GET DIAGNOSTICS affected=ROW_COUNT;changed:=changed+affected;
   END LOOP;
  END LOOP;
 END IF;
 -- T1XL has one finished assembly per side. Upper/Lower remain component
 -- identities, not extra finished-output measurements. Keep both observed IDs.
 FOR part IN SELECT e.id,e.data_json::jsonb d FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name' IN ('T1XL LH Lower + Upper','T1XL RH Lower + Upper') LOOP
  hand:=part.d->>'side';
  IF hand NOT IN ('LH','RH') THEN hand:=substring(part.d->>'name' from 'T1XL (LH|RH)'); END IF;
  changed:=changed+pg_temp.review_part(selected_owner,selected_project,jsonb_build_object('id',part.id,'type','Part','name','T1XL '||hand,'itemKind','product','productionFamily','LDM','productFamily','T1XL','side',hand,'sourcePartName',part.d->>'name','context','Owner review: one T1XL finished assembly per LH/RH. Upper and Lower are intermediate components; original observations retain this ID.'));
 END LOOP;

 -- The owner confirmed two discrete inputs for EACH Upper/Lower RH/LH
 -- Integration. This confirms composition and per-assembly input quantities,
 -- not router yield, a new machine asset, or an unrecorded upstream route.
 SELECT e.id INTO integration_id FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Production Step' AND e.data_json::jsonb->>'name'='G65 · Integration' ORDER BY e.rowid LIMIT 1;
 SELECT e.id INTO lam_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Production Step' AND e.data_json::jsonb->>'name'='G65 main (route label) · LAM assembly' ORDER BY e.rowid LIMIT 1;
 IF EXISTS(SELECT 1 FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name' IN ('G65 Upper RH','G65 Upper LH','G65 Lower RH','G65 Lower LH')) THEN
  IF integration_id IS NULL THEN
   integration_id:='ls-step-g65-integration';
   changed:=changed+pg_temp.review_part(selected_owner,selected_project,jsonb_build_object('id',integration_id,'type','Production Step','name','G65 · Integration','status','active','productionStage','Integration','productionFamily','LDM','context','Owner-confirmed integration of G65 numbered component 1 and 2. Further route order is not inferred.'));
  END IF;
  FOR position_name IN SELECT unnest(ARRAY['Upper','Lower']) LOOP
   FOR hand IN SELECT unnest(ARRAY['RH','LH']) LOOP
    final_name:='G65 '||position_name||' '||hand;
    SELECT e.id INTO final_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Part' AND e.data_json::jsonb->>'name'=final_name AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived' ORDER BY e.rowid LIMIT 1;
    IF final_id IS NULL THEN CONTINUE; END IF;
    changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-integration-route-'||final_id,'type','applies_to','from',integration_id,'to',final_id,'evidence','Owner confirmed G65 Upper/Lower LH/RH numbered-component Integration.'));
    SELECT e.id INTO assembly_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Part' AND e.data_json::jsonb->>'name'=final_name||' main' ORDER BY e.rowid LIMIT 1;
    assembly_id:=coalesce(assembly_id,'ls-g65-'||lower(position_name)||'-'||lower(hand)||'-integration-assembly');
    changed:=changed+pg_temp.review_part(selected_owner,selected_project,jsonb_build_object('id',assembly_id,'type','Part','name',final_name||' main','status','active','itemKind','component','productionFamily','LDM','productFamily','G65','side',hand,'verticalPosition',position_name,'context','Intermediate numbered-component Integration assembly for this exact G65 variant; not an additional finished output.'));
    changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-g65-assembly-parent-'||assembly_id,'type','part_of','from',assembly_id,'to',final_id,'evidence','Owner-confirmed Upper/Lower LH/RH assembly structure.'));
    changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-g65-integration-output-'||assembly_id,'type','produces','from',integration_id,'to',assembly_id,'quantity',1,'unit','piece','basis','per one Integration assembly','routePartId',final_id,'reviewState','confirmed','evidence','Components 1 and 2 combine into one assembly; this is a BOM quantity, not observed output.'));
    IF lam_id IS NOT NULL THEN
     changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-g65-lam-route-'||final_id,'type','applies_to','from',lam_id,'to',final_id,'evidence','Existing G65 Integration → LAM route; owner confirmed this structure only for Upper/Lower RH/LH.'));
     changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-g65-lam-input-'||assembly_id,'type','consumes','from',lam_id,'to',assembly_id,'quantity',1,'unit','piece','basis','per one final assembly','routePartId',final_id,'reviewState','confirmed','evidence','Intermediate Integration assembly enters existing G65 LAM operation. Additional materials are not inferred.'));
     changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-g65-lam-output-'||final_id,'type','produces','from',lam_id,'to',final_id,'quantity',1,'unit','piece','basis','per one final assembly','routePartId',final_id,'reviewState','confirmed','evidence','Finished Upper/Lower RH/LH identity, distinct from its numbered components and intermediate assembly.'));
    END IF;
    FOR piece_number IN 1..2 LOOP
     piece_name:=final_name||' '||piece_number;
     SELECT e.id,e.data_json::jsonb->>'name' INTO piece_id,original_name FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Part' AND e.data_json::jsonb->>'name' IN (piece_name,final_name||' Plate '||piece_number) ORDER BY e.rowid LIMIT 1;
     piece_id:=coalesce(piece_id,'ls-g65-'||lower(position_name)||'-'||lower(hand)||'-piece-'||piece_number);
     changed:=changed+pg_temp.review_part(selected_owner,selected_project,jsonb_strip_nulls(jsonb_build_object('id',piece_id,'type','Part','name',piece_name,'status','active','itemKind','component','productionFamily','LDM','productFamily','G65','side',hand,'verticalPosition',position_name,'pieceIndex',piece_number::text,'sourcePartName',CASE WHEN original_name IS DISTINCT FROM piece_name THEN original_name END,'context','Owner-confirmed intermediate component; one piece enters its exact G65 variant Integration. Router yield remains separately recorded.')));
     changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-g65-component-'||piece_id,'type','part_of','from',piece_id,'to',assembly_id,'evidence','Owner-confirmed physical constituent of this exact Upper/Lower and RH/LH Integration assembly.'));
     changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-g65-input-'||piece_id,'type','consumes','from',integration_id,'to',piece_id,'quantity',1,'unit','piece','basis','per one '||final_name||' Integration','routePartId',final_id,'reviewState','confirmed','evidence','Owner: numbered components 1 and 2, one each, join at Integration.'));
    END LOOP;
   END LOOP;
  END LOOP;
 END IF;


 -- A line-to-part ontology edge carries line responsibility to final AND
 -- intermediate parts. Existing line Leaders/Supervisors/managers stay canonical;
 -- this is not a newly asserted station assignment or a physical output quantity.
 SELECT e.id INTO line_id FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Resource' AND e.data_json::jsonb->>'resourceKind'='line' AND e.data_json::jsonb->>'name'='LDM' AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived' ORDER BY e.rowid LIMIT 1;
 IF line_id IS NOT NULL THEN
  IF integration_id IS NOT NULL THEN changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-g65-integration-line','type','operated_in','from',integration_id,'to',line_id,'evidence','Owner-confirmed G65 Integration in LDM; line-level responsibility.')); END IF;
  FOR part IN SELECT e.id FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'productionFamily'='LDM' AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived' LOOP
   changed:=changed+pg_temp.review_link(selected_owner,selected_project,jsonb_build_object('id','review-ldm-part-'||part.id,'type','produces','from',line_id,'to',part.id,'evidence','Owner-confirmed LDM line responsibility for its detailed parts; existing line contact and management chain applies.','basis','line membership; no output quantity inferred','reviewState','confirmed'));
  END LOOP;
 END IF;
 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
DROP FUNCTION pg_temp.review_part(UUID,TEXT,JSONB);
DROP FUNCTION pg_temp.review_link(UUID,TEXT,JSONB);
