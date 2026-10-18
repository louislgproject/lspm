-- Attach recorded intermediates to the final part they are named for, and
-- show those steps on that part's process row. Does not invent LH pieces,
-- a Lower assembly step, or a finished SKU that was never recorded.
DO $$
DECLARE
 selected_owner UUID; selected_project TEXT; spec RECORD; parent_id TEXT; child_id TEXT; step RECORD;
 link_id TEXT; route_id TEXT; material_id TEXT; changed INTEGER:=0; affected INTEGER;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT p.id INTO selected_project FROM pm.projects p WHERE p.owner_id=selected_owner AND p.name='LS' AND p.status='active' LIMIT 1;
 IF selected_project IS NULL THEN RETURN; END IF;
 FOR spec IN SELECT * FROM (VALUES
  ('G65 Upper RH Plate 1','G65 Upper RH'),
  ('G65 Upper RH Plate 2','G65 Upper RH'),
  ('G65 Upper RH Connector','G65 Upper RH'),
  ('G65 Upper RH main','G65 Upper RH'),
  ('G65 Upper RH Black Plastic','G65 Upper RH'),
  ('G65 Upper RH Crystal Plastic','G65 Upper RH'),
  ('G65 Lower RH Plate 1','G65 Lower RH'),
  ('G65 Lower RH Plate 2','G65 Lower RH')
 ) AS pairs(child_name,parent_name) LOOP
  SELECT e.id INTO parent_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec.parent_name
   ORDER BY e.rowid LIMIT 1;
  SELECT e.id INTO child_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec.child_name
   ORDER BY e.rowid LIMIT 1;
  IF parent_id IS NULL OR child_id IS NULL THEN CONTINUE; END IF;
  link_id:='hier-of-'||substr(md5(child_id||'>'||parent_id),1,20);
  INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
  SELECT selected_owner,link_id,'part_of',child_id,parent_id,NULL,
   jsonb_build_object('id',link_id,'type','part_of','from',child_id,'to',parent_id,'evidence','Named intermediate of this final part. Not a separate shipped output.')::text
  WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='part_of' AND r.from_id=child_id AND r.to_id=parent_id);
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
  FOR step IN SELECT r.from_id,r.to_id,r.type,r.data_json::jsonb AS data FROM pm.relations r
   WHERE r.owner_id=selected_owner AND r.to_id=child_id AND r.type IN ('consumes','produces') LOOP
   route_id:='hier-route-'||substr(md5(step.from_id||'>'||parent_id),1,20);
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
   SELECT selected_owner,route_id,'applies_to',step.from_id,parent_id,NULL,
    jsonb_build_object('id',route_id,'type','applies_to','from',step.from_id,'to',parent_id,'evidence','Step already records this final part''s intermediate.')::text
   WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='applies_to' AND r.from_id=step.from_id AND r.to_id=parent_id);
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
   material_id:='hier-mat-'||substr(md5(step.from_id||step.type||child_id||parent_id),1,20);
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
   SELECT selected_owner,material_id,step.type,step.from_id,child_id,NULL,
    (step.data||jsonb_build_object('id',material_id,'routePartId',parent_id,'evidence',trim(coalesce(step.data->>'evidence','')||' Shown on the named final part.')))::text
   WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type=step.type AND r.from_id=step.from_id AND r.to_id=child_id AND r.data_json::jsonb->>'routePartId'=parent_id);
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
  END LOOP;
 END LOOP;
 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
