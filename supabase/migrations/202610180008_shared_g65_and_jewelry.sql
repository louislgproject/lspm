-- Owner answers: every G65 Upper/Lower hand shares the recorded lamp process,
-- LH has the same connector and plastics as RH, and Jewelry is ICT, Router, then shipment.
-- Numbered pieces 1 and 2 already exist. Do not create a second "Plate" identity.
DO $$
DECLARE
 selected_owner UUID; selected_project TEXT; spec RECORD; flow RECORD; variant_id TEXT; child_id TEXT; step_id TEXT;
 link_id TEXT; route_id TEXT; material_id TEXT; changed INTEGER:=0; affected INTEGER; child_name TEXT; child_data JSONB;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT p.id INTO selected_project FROM pm.projects p WHERE p.owner_id=selected_owner AND p.name='LS' AND p.status='active' LIMIT 1;
 IF selected_project IS NULL THEN RETURN; END IF;

 FOR spec IN SELECT e.id AS variant_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part'
    AND e.data_json::jsonb->>'name' IN ('G65 Upper','G65 Lower','G65 Upper RH','G65 Upper LH','G65 Lower RH','G65 Lower LH')
    AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived' LOOP
  FOR step_id IN SELECT DISTINCT r.from_id FROM pm.relations r
    JOIN pm.entities base ON base.owner_id=r.owner_id AND base.id=r.to_id
    JOIN pm.entities step ON step.owner_id=r.owner_id AND step.id=r.from_id
    WHERE r.owner_id=selected_owner AND r.type='applies_to' AND base.data_json::jsonb->>'name'='G65 main (route label)'
     AND step.type='Production Step' AND step.data_json::jsonb->>'status' IS DISTINCT FROM 'archived' LOOP
   route_id:='shared-g65-'||substr(md5(step_id||'>'||spec.variant_id),1,20);
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
   SELECT selected_owner,route_id,'applies_to',step_id,spec.variant_id,NULL,
    jsonb_build_object('id',route_id,'type','applies_to','from',step_id,'to',spec.variant_id,'evidence','Owner confirmed G65 Upper, Lower, RH and LH share this process.')::text
   WHERE NOT EXISTS(SELECT 1 FROM pm.relations x WHERE x.owner_id=selected_owner AND x.type='applies_to' AND x.from_id=step_id AND x.to_id=spec.variant_id);
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
  END LOOP;
 END LOOP;

 FOR spec IN SELECT * FROM (VALUES
  ('G65 Upper RH','RH','Upper'),
  ('G65 Upper LH','LH','Upper'),
  ('G65 Lower RH','RH','Lower'),
  ('G65 Lower LH','LH','Lower')
 ) AS v(variant_name,side_name,vertical_name) LOOP
  SELECT e.id INTO variant_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec.variant_name
    AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived'
   ORDER BY e.rowid LIMIT 1;
  IF variant_id IS NULL THEN CONTINUE; END IF;
  FOR flow IN SELECT * FROM (VALUES
   ('Connector','G65 · Integration'),
   ('Black Plastic','G65 main (route label) · LAM assembly'),
   ('Crystal Plastic','G65 main (route label) · LAM assembly')
  ) AS f(piece,step_name) LOOP
   child_name:=spec.variant_name||' '||flow.piece;
   SELECT e.id INTO child_id FROM pm.entities e
    JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
    WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=child_name
    ORDER BY e.rowid LIMIT 1;
   IF child_id IS NULL THEN
    child_id:='ls-comp-'||substr(md5(child_name),1,20);
    child_data:=jsonb_build_object('id',child_id,'type','Part','name',child_name,'status','active','itemKind','component','productionFamily','LDM','productFamily','G65','side',spec.side_name,'verticalPosition',spec.vertical_name,'context','Same connector or plastic on every G65 Upper/Lower hand. Not a shipped output.');
    INSERT INTO pm.entities(owner_id,id,type,data_json) VALUES(selected_owner,child_id,'Part',child_data::text);
    INSERT INTO pm.project_memberships(owner_id,project_id,entity_id) VALUES(selected_owner,selected_project,child_id);
    INSERT INTO pm.project_workstreams(owner_id,project_id,entity_id,code) VALUES(selected_owner,selected_project,child_id,'production');
    changed:=changed+1;
   END IF;
   link_id:='hier-of-'||substr(md5(child_id||'>'||variant_id),1,20);
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
   SELECT selected_owner,link_id,'part_of',child_id,variant_id,NULL,
    jsonb_build_object('id',link_id,'type','part_of','from',child_id,'to',variant_id,'evidence','Intermediate of this hand. Not a shipped output.')::text
   WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='part_of' AND r.from_id=child_id AND r.to_id=variant_id);
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
   SELECT e.id INTO step_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Production Step' AND e.data_json::jsonb->>'name'=flow.step_name ORDER BY e.rowid LIMIT 1;
   IF step_id IS NULL THEN CONTINUE; END IF;
   material_id:='hand-mat-'||substr(md5(step_id||'consumes'||child_id||variant_id),1,20);
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
   SELECT selected_owner,material_id,'consumes',step_id,child_id,NULL,
    jsonb_build_object('id',material_id,'type','consumes','from',step_id,'to',child_id,'routePartId',variant_id,'reviewState','proposed','evidence','Owner confirmed this hand uses the same connector and plastics.')::text
   WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='consumes' AND r.from_id=step_id AND r.to_id=child_id AND coalesce(r.data_json::jsonb->>'routePartId','')=variant_id);
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
  END LOOP;
 END LOOP;

 FOR flow IN SELECT * FROM (VALUES
  ('ls-step-g65-jewelry-ict','G65 Jewelry Piece · ICT','ICT'),
  ('ls-step-g65-jewelry-router','G65 Jewelry Piece · Router','Router'),
  ('ls-step-g65-jewelry-ship','G65 Jewelry Piece · 출고','출고')
 ) AS s(step_key,step_name,stage_name) LOOP
  IF NOT EXISTS(SELECT 1 FROM pm.entities e WHERE e.owner_id=selected_owner AND e.id=flow.step_key) THEN
   INSERT INTO pm.entities(owner_id,id,type,data_json) VALUES(selected_owner,flow.step_key,'Production Step',jsonb_build_object(
    'id',flow.step_key,'type','Production Step','name',flow.step_name,'status','active','processLevel','main','productionStage',flow.stage_name,
    'context','Owner confirmed Jewelry route: ICT, then Router, then shipment.')::text);
   INSERT INTO pm.project_memberships(owner_id,project_id,entity_id) VALUES(selected_owner,selected_project,flow.step_key);
   INSERT INTO pm.project_workstreams(owner_id,project_id,entity_id,code) VALUES(selected_owner,selected_project,flow.step_key,'production');
   changed:=changed+1;
  END IF;
 END LOOP;
 INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
 SELECT selected_owner,'ls-rel-g65-jewelry-seq-1','precedes','ls-step-g65-jewelry-ict','ls-step-g65-jewelry-router',NULL,
  jsonb_build_object('id','ls-rel-g65-jewelry-seq-1','type','precedes','from','ls-step-g65-jewelry-ict','to','ls-step-g65-jewelry-router','evidence','Owner confirmed Jewelry order: ICT then Router then shipment.')::text
 WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.id='ls-rel-g65-jewelry-seq-1');
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
 INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
 SELECT selected_owner,'ls-rel-g65-jewelry-seq-2','precedes','ls-step-g65-jewelry-router','ls-step-g65-jewelry-ship',NULL,
  jsonb_build_object('id','ls-rel-g65-jewelry-seq-2','type','precedes','from','ls-step-g65-jewelry-router','to','ls-step-g65-jewelry-ship','evidence','Owner confirmed Jewelry ships after Router.')::text
 WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.id='ls-rel-g65-jewelry-seq-2');
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
 FOR spec IN SELECT e.id AS variant_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part'
    AND e.data_json::jsonb->>'name' IN ('G65 Jewelry Piece','G65 Jewelry Piece RH','G65 Jewelry Piece LH') LOOP
  FOR step_id IN SELECT unnest(ARRAY['ls-step-g65-jewelry-ict','ls-step-g65-jewelry-router','ls-step-g65-jewelry-ship']) LOOP
   route_id:='jew-route-'||substr(md5(step_id||'>'||spec.variant_id),1,20);
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
   SELECT selected_owner,route_id,'applies_to',step_id,spec.variant_id,NULL,
    jsonb_build_object('id',route_id,'type','applies_to','from',step_id,'to',spec.variant_id,'evidence','Owner confirmed Jewelry route: ICT, Router, then shipment.')::text
   WHERE NOT EXISTS(SELECT 1 FROM pm.relations x WHERE x.owner_id=selected_owner AND x.type='applies_to' AND x.from_id=step_id AND x.to_id=spec.variant_id);
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
  END LOOP;
 END LOOP;
 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
