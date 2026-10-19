-- LH pieces 1 and 2 already enter that hand at Integration, but only RH linked
-- them to the hand as well as to "main". T1XL LH/RH were parented twice, under
-- the classification and under a second node with the same name.
DO $$
DECLARE
 selected_owner UUID; selected_project TEXT; spec RECORD; hand_id TEXT; piece_id TEXT;
 link_id TEXT; material_id TEXT; changed INTEGER:=0; affected INTEGER;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT p.id INTO selected_project FROM pm.projects p WHERE p.owner_id=selected_owner AND p.name='LS' AND p.status='active' LIMIT 1;
 IF selected_project IS NULL THEN RETURN; END IF;

 FOR spec IN SELECT * FROM (VALUES
  ('G65 Upper LH 1','G65 Upper LH'),
  ('G65 Upper LH 2','G65 Upper LH'),
  ('G65 Lower LH 1','G65 Lower LH'),
  ('G65 Lower LH 2','G65 Lower LH')
 ) AS v(piece_name,hand_name) LOOP
  SELECT e.id INTO hand_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec.hand_name
   ORDER BY e.rowid LIMIT 1;
  SELECT e.id INTO piece_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec.piece_name
   ORDER BY e.rowid LIMIT 1;
  IF hand_id IS NULL OR piece_id IS NULL THEN CONTINUE; END IF;
  link_id:='hier-of-'||substr(md5(piece_id||'>'||hand_id),1,20);
  INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
  SELECT selected_owner,link_id,'part_of',piece_id,hand_id,NULL,
   jsonb_build_object('id',link_id,'type','part_of','from',piece_id,'to',hand_id,'evidence','Same as RH: this numbered piece is a constituent of the hand, not only of main.')::text
  WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='part_of' AND r.from_id=piece_id AND r.to_id=hand_id);
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
 END LOOP;

 DELETE FROM pm.relations r
 USING pm.entities child, pm.entities parent
 WHERE r.owner_id=selected_owner AND r.type='part_of' AND r.from_id=child.id AND child.owner_id=selected_owner
  AND r.to_id=parent.id AND parent.owner_id=selected_owner
  AND child.id IN ('ls-t1xl-lh','ls-t1xl-rh') AND parent.id='ls-part-t1xl';
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
