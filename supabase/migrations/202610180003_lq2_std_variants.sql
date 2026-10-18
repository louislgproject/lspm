-- The owner requested all four LQ2 STD IB/OB × RH/LH final-part identities.
-- Reuse existing identities and routes; never allocate existing quantities.
DO $$
DECLARE selected_owner UUID; selected_project TEXT; base JSONB; mount TEXT; hand TEXT;
 final_id TEXT; final_name TEXT; route RECORD; affected INTEGER; changed INTEGER:=0;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT e.data_json::jsonb,m.project_id INTO base,selected_project
 FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
 JOIN pm.projects p ON p.owner_id=m.owner_id AND p.id=m.project_id
 WHERE e.owner_id=selected_owner AND e.data_json::jsonb->>'name'='LQ2 STD' AND p.name='LS' AND p.status='active' LIMIT 1;
 IF base IS NULL THEN RETURN; END IF;
 FOR mount IN SELECT unnest(ARRAY['IB','OB']) LOOP
  FOR hand IN SELECT unnest(ARRAY['RH','LH']) LOOP
   final_name:='LQ2 STD '||mount||' '||hand;
   SELECT e.id INTO final_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Part' AND e.data_json::jsonb->>'name'=final_name LIMIT 1;
   IF final_id IS NULL THEN
    final_id:='ls-lq2-std-'||lower(mount)||'-'||lower(hand);
    INSERT INTO pm.entities(owner_id,id,type,data_json) VALUES(selected_owner,final_id,'Part',jsonb_build_object(
     'id',final_id,'type','Part','name',final_name,'status','active','itemKind','product',
     'productionFamily',coalesce(base->>'productionFamily','LDM'),'productFamily',coalesce(base->>'productFamily','LQ2'),
     'inOut',mount,'side',hand,'context','Final-part combination requested by the workspace owner. Existing quantities are not allocated or copied.')::text);
    changed:=changed+1;
   END IF;
   INSERT INTO pm.project_memberships(owner_id,project_id,entity_id) VALUES(selected_owner,selected_project,final_id) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
   INSERT INTO pm.project_workstreams(owner_id,project_id,entity_id,code) VALUES(selected_owner,selected_project,final_id,'production') ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
   SELECT selected_owner,'final-part-parent-'||final_id,'part_of',final_id,base->>'id',selected_project,
    jsonb_build_object('id','final-part-parent-'||final_id,'type','part_of','from',final_id,'to',base->>'id','evidence','Workspace owner final-part classification')::text
   WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='part_of' AND r.from_id=final_id AND r.to_id=base->>'id');
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
   FOR route IN SELECT DISTINCT r.from_id FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='applies_to' AND r.to_id=base->>'id' AND (r.scope_project_id IS NULL OR r.scope_project_id=selected_project) LOOP
    INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
    SELECT selected_owner,'final-part-route-'||final_id||'-'||route.from_id,'applies_to',route.from_id,final_id,selected_project,
     jsonb_build_object('id','final-part-route-'||final_id||'-'||route.from_id,'type','applies_to','from',route.from_id,'to',final_id,'evidence','Existing LQ2 STD route; final-part measurement')::text
    WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='applies_to' AND r.from_id=route.from_id AND r.to_id=final_id AND (r.scope_project_id IS NULL OR r.scope_project_id=selected_project));
    GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
   END LOOP;
  END LOOP;
 END LOOP;
 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
