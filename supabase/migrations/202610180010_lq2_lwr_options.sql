-- Owner correction supersedes the old photo/catalog: T1-2 Lower does not exist.
-- LQ2 LWR has STD/OPT, then LH/RH (no IB/OB). OPT adds ICT before cutting.
-- Retain old identities and observations without inferring IB/OB -> STD/OPT.
CREATE FUNCTION pg_temp.correct_part(owner UUID, project TEXT, doc JSONB) RETURNS INTEGER
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
CREATE FUNCTION pg_temp.correct_link(owner UUID, project TEXT, doc JSONB) RETURNS INTEGER
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
DECLARE selected_owner UUID; selected_project TEXT; base_id TEXT; model_id TEXT; final_id TEXT; cut_id TEXT; line_id TEXT;
 ict_id TEXT:='ls-step-lq2-lwr-opt-ict'; option_name TEXT; hand TEXT; item RECORD; route RECORD; changed INTEGER:=0; affected INTEGER;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT id INTO selected_project FROM pm.projects WHERE owner_id=selected_owner AND name='LS' AND status='active' ORDER BY rowid LIMIT 1;
 IF selected_project IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM pm.meta WHERE owner_id=selected_owner AND key='revision' FOR UPDATE;
 FOR item IN SELECT e.id FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
  WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND
   (e.data_json::jsonb->>'name'='T1-2 Lower' OR e.data_json::jsonb->>'name' ~ '^T1-2 Lower (STD|OPT) (LH|RH)$' OR e.data_json::jsonb->>'name' ~ '^LQ2 LWR (IB|OB) (LH|RH)$') LOOP
  UPDATE pm.entities SET data_json=((data_json::jsonb-'replacedByPartId')||jsonb_build_object('status','archived','mappingState','retired_variant','context','Owner corrected this mistaken classification. Original records remain on this identity; no quantity or option reassignment.'))::text
   WHERE owner_id=selected_owner AND id=item.id AND (data_json::jsonb->>'status' IS DISTINCT FROM 'archived' OR data_json::jsonb->>'mappingState' IS DISTINCT FROM 'retired_variant' OR data_json::jsonb ? 'replacedByPartId');
  GET DIAGNOSTICS affected=ROW_COUNT;changed:=changed+affected;
 END LOOP;
 SELECT e.id INTO base_id FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
  WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'='LQ2 LWR' ORDER BY e.rowid LIMIT 1;
 IF base_id IS NOT NULL THEN
  SELECT e.id INTO cut_id FROM pm.entities e JOIN pm.relations r ON r.owner_id=e.owner_id AND r.from_id=e.id
   WHERE e.owner_id=selected_owner AND r.type='applies_to' AND r.to_id=base_id AND (r.scope_project_id IS NULL OR r.scope_project_id=selected_project)
    AND e.type='Production Step' AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived'
    AND (e.data_json::jsonb->>'productionStage'='Array cutting' OR e.data_json::jsonb->>'name'='LQ2 LWR · Array cutting') ORDER BY e.rowid LIMIT 1;
  IF cut_id IS NULL THEN RAISE EXCEPTION 'LQ2 LWR correction requires the existing Array cutting step; no route was inferred.'; END IF;
  SELECT e.id INTO line_id FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Resource' AND e.data_json::jsonb->>'resourceKind'='line' AND e.data_json::jsonb->>'name'='LDM' ORDER BY e.rowid LIMIT 1;
  changed:=changed+pg_temp.correct_part(selected_owner,selected_project,jsonb_build_object('id',ict_id,'type','Production Step','name','LQ2 LWR OPT · ICT','status','active','processLevel','main','productionStage','ICT','context','Owner correction: LQ2 LWR OPT adds ICT before the existing cutting route. No machine asset or observations inferred.'));
  changed:=changed+pg_temp.correct_link(selected_owner,selected_project,jsonb_build_object('id','lwr-opt-ict-before-cutting','type','precedes','from',ict_id,'to',cut_id,'evidence','Owner added ICT to LWR OPT; existing downstream sequence retained.'));
  IF line_id IS NOT NULL THEN changed:=changed+pg_temp.correct_link(selected_owner,selected_project,jsonb_build_object('id','lwr-opt-ict-line','type','operated_in','from',ict_id,'to',line_id,'evidence','LQ2 LWR OPT in existing LDM line; no individual machine inferred.')); END IF;
  FOR option_name IN SELECT unnest(ARRAY['STD','OPT']) LOOP
   model_id:='ls-part-lq2-lwr-'||lower(option_name);
   changed:=changed+pg_temp.correct_part(selected_owner,selected_project,jsonb_build_object('id',model_id,'type','Part','name','LQ2 LWR '||option_name,'status','active','itemKind','product','productionFamily','LDM','productFamily','LQ2','productOption',option_name,'mappingState','confirmed','routeStatus','registered','context','Owner: LWR options STD/OPT, each with LH/RH; no IB/OB. Existing aggregate observations stay at LQ2 LWR.'));
   changed:=changed+pg_temp.correct_link(selected_owner,selected_project,jsonb_build_object('id','lwr-option-parent-'||model_id,'type','part_of','from',model_id,'to',base_id,'evidence','Owner-corrected LQ2 LWR option hierarchy.'));
   FOR hand IN SELECT unnest(ARRAY['LH','RH']) LOOP
    final_id:='ls-final-lq2-lwr-'||lower(option_name)||'-'||lower(hand);
    changed:=changed+pg_temp.correct_part(selected_owner,selected_project,jsonb_build_object('id',final_id,'type','Part','name','LQ2 LWR '||option_name||' '||hand,'status','active','itemKind','product','productionFamily','LDM','productFamily','LQ2','productOption',option_name,'side',hand,'mappingState','confirmed','routeStatus','registered','context','Owner-corrected final part. No correspondence with the mistaken IB/OB identities or their quantities is assumed.'));
    changed:=changed+pg_temp.correct_link(selected_owner,selected_project,jsonb_build_object('id','lwr-final-parent-'||final_id,'type','part_of','from',final_id,'to',model_id,'evidence','LQ2 LWR option then LH/RH; no IB/OB.'));
   END LOOP;
   FOR item IN SELECT unnest(ARRAY[model_id,'ls-final-lq2-lwr-'||lower(option_name)||'-lh','ls-final-lq2-lwr-'||lower(option_name)||'-rh']) AS id LOOP
    FOR route IN SELECT DISTINCT r.from_id FROM pm.relations r JOIN pm.entities e ON e.owner_id=r.owner_id AND e.id=r.from_id
     WHERE r.owner_id=selected_owner AND r.type='applies_to' AND r.to_id=base_id AND (r.scope_project_id IS NULL OR r.scope_project_id=selected_project) AND e.type='Production Step' AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived' LOOP
     changed:=changed+pg_temp.correct_link(selected_owner,selected_project,jsonb_build_object('id','lwr-shared-'||substr(md5(route.from_id||'>'||item.id),1,20),'type','applies_to','from',route.from_id,'to',item.id,'evidence','Owner: preserve existing LWR route for this exact option and hand.'));
    END LOOP;
    IF option_name='OPT' THEN changed:=changed+pg_temp.correct_link(selected_owner,selected_project,jsonb_build_object('id','lwr-opt-ict-'||item.id,'type','applies_to','from',ict_id,'to',item.id,'evidence','Owner: ICT applies to LQ2 LWR OPT, not STD.')); END IF;
    IF line_id IS NOT NULL THEN changed:=changed+pg_temp.correct_link(selected_owner,selected_project,jsonb_build_object('id','lwr-part-line-'||item.id,'type','produces','from',line_id,'to',item.id,'basis','line membership; no output quantity inferred','reviewState','confirmed','evidence','Existing LDM responsibility chain for the corrected LWR part.')); END IF;
   END LOOP;
  END LOOP;
 END IF;
 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
DROP FUNCTION pg_temp.correct_part(UUID,TEXT,JSONB);
DROP FUNCTION pg_temp.correct_link(UUID,TEXT,JSONB);
