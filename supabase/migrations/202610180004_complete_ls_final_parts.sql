-- Owner-requested model/option/IB-OB/side catalog. No quantities or official
-- model codes are generated. Existing final identities and their routes win.
DO $$
DECLARE selected_owner UUID; selected_project TEXT; spec JSONB; variant JSONB; base_row RECORD; parent_row RECORD; route RECORD;
 base_data JSONB; base_id TEXT; final_id TEXT; final_name TEXT; mount TEXT; hand TEXT; option_name TEXT;
 variants JSONB; affected INTEGER; changed INTEGER:=0; made BOOLEAN;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT p.id INTO selected_project FROM pm.projects p WHERE p.owner_id=selected_owner AND p.name='LS' AND p.status='active' LIMIT 1;
 IF selected_project IS NULL THEN RETURN; END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements($catalog$[
  {"base":"LQ2 STD","positions":["IB","OB"],"family":"LQ2"},
  {"base":"LQ2 OPT","positions":["IB","OB"],"family":"LQ2"},
  {"base":"LQ2 LWR","positions":["IB","OB"],"family":"LQ2"},
  {"base":"LQ2 primary light source","positions":["IB","OB"],"family":"LQ2"},
  {"base":"G65 Upper","family":"G65"},
  {"base":"G65 Lower","family":"G65"},
  {"base":"G65 Side Marker","family":"G65"},
  {"base":"G65 Cornering","family":"G65"},
  {"base":"G65 Jewelry Piece","family":"G65"},
  {"base":"T1XL","family":"T1XL","names":["T1XL RH Lower + Upper","T1XL LH Lower + Upper"]},
  {"base":"T1-2 Base","family":"T1-2"},
  {"base":"T1-2 Uplevel","family":"T1-2"},
  {"base":"T1-2 Lower","family":"T1-2","options":["STD","OPT"],"create":true},
  {"base":"P768 A-2","family":"P768"},
  {"base":"BL7m PE P","family":"BL7m"},
  {"base":"Flex-N-Gate BiLED","family":"BiLED"}
 ]$catalog$::jsonb) LOOP
  SELECT e.id,e.data_json::jsonb INTO base_id,base_data FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec->>'base'
   ORDER BY CASE WHEN e.id LIKE 'ls-part-%' THEN 0 ELSE 1 END,e.rowid LIMIT 1;
  IF base_id IS NULL AND coalesce((spec->>'create')::boolean,false) THEN
   base_id:='ls-part-t1-2-lower';base_data:=jsonb_build_object('id',base_id,'type','Part','name',spec->>'base','status','active','itemKind','product','productionFamily','LDM','productFamily',spec->>'family','mappingState','unresolved','routeStatus','unregistered','context','Owner-confirmed separate T1-2 Lower model. Its process route awaits confirmation; no Base/Uplevel route is assumed.');
   INSERT INTO pm.entities(owner_id,id,type,data_json) VALUES(selected_owner,base_id,'Part',base_data::text);
   INSERT INTO pm.project_memberships(owner_id,project_id,entity_id) VALUES(selected_owner,selected_project,base_id);
   INSERT INTO pm.project_workstreams(owner_id,project_id,entity_id,code) VALUES(selected_owner,selected_project,base_id,'production');
   changed:=changed+1;
  END IF;
  IF base_id IS NULL THEN CONTINUE; END IF;
  variants:='[]'::jsonb;
  FOR mount IN SELECT value FROM jsonb_array_elements_text(coalesce(spec->'positions','[""]'::jsonb)) LOOP
   FOR option_name IN SELECT value FROM jsonb_array_elements_text(coalesce(spec->'options','[""]'::jsonb)) LOOP
    FOR hand IN SELECT unnest(ARRAY['RH','LH']) LOOP
     final_name:=coalesce(spec->'names'->>(CASE WHEN hand='RH' THEN 0 ELSE 1 END),concat_ws(' ',spec->>'base',nullif(option_name,''),nullif(mount,''),hand));
     variants:=variants||jsonb_build_array(jsonb_build_object('name',final_name,'side',hand,'inOut',mount,'productOption',option_name));
    END LOOP;
   END LOOP;
  END LOOP;
  FOR variant IN SELECT value FROM jsonb_array_elements(variants) LOOP
   SELECT e.id INTO final_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Part' AND e.data_json::jsonb->>'name'=variant->>'name' ORDER BY e.rowid LIMIT 1;
   made:=final_id IS NULL;
   IF made THEN
    final_id:='ls-final-'||regexp_replace(lower(variant->>'name'),'[^a-z0-9]+','-','g');
    INSERT INTO pm.entities(owner_id,id,type,data_json) VALUES(selected_owner,final_id,'Part',jsonb_strip_nulls(jsonb_build_object(
     'id',final_id,'type','Part','name',variant->>'name','status','active','itemKind','product','productionFamily',coalesce(base_data->>'productionFamily','LDM'),'productFamily',spec->>'family',
     'side',variant->>'side','inOut',nullif(variant->>'inOut',''),'productOption',nullif(variant->>'productOption',''),
     'mappingState',CASE WHEN base_data->>'name'='T1-2 Lower' THEN 'unresolved' ELSE 'confirmed' END,
     'routeStatus',CASE WHEN EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='applies_to' AND r.to_id=base_id AND (r.scope_project_id IS NULL OR r.scope_project_id=selected_project)) THEN 'registered' ELSE 'unregistered' END,
     'context','Owner-requested final-part classification. Historical counts remain on their original identities.'))::text);
    changed:=changed+1;
   END IF;
   INSERT INTO pm.project_memberships(owner_id,project_id,entity_id) VALUES(selected_owner,selected_project,final_id) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS affected=ROW_COUNT;changed:=changed+affected;
   INSERT INTO pm.project_workstreams(owner_id,project_id,entity_id,code) VALUES(selected_owner,selected_project,final_id,'production') ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS affected=ROW_COUNT;changed:=changed+affected;
   -- A family and its retained route label can share the same children.
   FOR parent_row IN SELECT e.id FROM pm.entities e JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec->>'base' LOOP
    INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
    SELECT selected_owner,'catalog-parent-'||final_id||'-'||parent_row.id,'part_of',final_id,parent_row.id,selected_project,
     jsonb_build_object('id','catalog-parent-'||final_id||'-'||parent_row.id,'type','part_of','from',final_id,'to',parent_row.id,'evidence','Workspace owner final-part classification')::text
    WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='part_of' AND r.from_id=final_id AND r.to_id=parent_row.id);
    GET DIAGNOSTICS affected=ROW_COUNT;changed:=changed+affected;
   END LOOP;
   -- Never overwrite a final part's own established route with a broader route.
   IF made THEN
    FOR route IN SELECT DISTINCT r.from_id FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='applies_to' AND r.to_id=base_id AND (r.scope_project_id IS NULL OR r.scope_project_id=selected_project) LOOP
     INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
     VALUES(selected_owner,'catalog-route-'||final_id||'-'||route.from_id,'applies_to',route.from_id,final_id,selected_project,jsonb_build_object('id','catalog-route-'||final_id||'-'||route.from_id,'type','applies_to','from',route.from_id,'to',final_id,'evidence','Existing model route; separate final-part measurement')::text);
     changed:=changed+1;
    END LOOP;
   END IF;
  END LOOP;
 END LOOP;
 -- This retained graph object denotes a route group, not a measurable part.
 UPDATE pm.entities e SET data_json=(e.data_json::jsonb||jsonb_build_object('mappingState','route_group'))::text WHERE e.owner_id=selected_owner AND e.data_json::jsonb->>'name'='G65 main (route label)' AND e.data_json::jsonb->>'mappingState' IS DISTINCT FROM 'route_group';
 GET DIAGNOSTICS affected=ROW_COUNT;changed:=changed+affected;
 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
