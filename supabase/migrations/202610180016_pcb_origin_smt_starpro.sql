-- Owner: G65 PCBs are made on the internal SMT line. Named PCBs for every other
-- model come from Starpro. Boards with no recorded PCB identity are left alone.
DO $$
DECLARE
 selected_owner UUID; selected_project TEXT; part_name TEXT; part_id TEXT;
 smt_id TEXT; starpro_id TEXT; starpro_line_id TEXT; link_id TEXT;
 changed INTEGER:=0; affected INTEGER; note TEXT;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT p.id INTO selected_project FROM pm.projects p WHERE p.owner_id=selected_owner AND p.name='LS' AND p.status='active' LIMIT 1;
 IF selected_project IS NULL THEN RETURN; END IF;

 SELECT e.id INTO smt_id FROM pm.entities e
  WHERE e.owner_id=selected_owner AND e.type='Resource' AND e.data_json::jsonb->>'name'='SMT'
  ORDER BY e.rowid LIMIT 1;
 SELECT e.id INTO starpro_id FROM pm.entities e
  WHERE e.owner_id=selected_owner AND e.type='Organization' AND e.data_json::jsonb->>'name'='Starpro'
  ORDER BY e.rowid LIMIT 1;
 SELECT e.id INTO starpro_line_id FROM pm.entities e
  WHERE e.owner_id=selected_owner AND e.type='Resource' AND e.data_json::jsonb->>'name'='Starpro SMT'
  ORDER BY e.rowid LIMIT 1;

 IF smt_id IS NOT NULL THEN
  UPDATE pm.relations r SET data_json=(r.data_json::jsonb || jsonb_build_object(
   'evidence','Owner 2026-10-18: this G65 PCB is made on internal SMT, not at Starpro.'
  ))::text
  FROM pm.entities part
  WHERE r.owner_id=selected_owner AND r.type='produces' AND r.from_id=smt_id AND r.to_id=part.id
   AND part.owner_id=selected_owner
   AND part.data_json::jsonb->>'name' IN (
    'G65 PCB','G65 Side Marker LH PCB','G65 Side Marker RH PCB','G65 Cornering LH PCB','G65 Cornering RH PCB'
   )
   AND coalesce(r.data_json::jsonb->>'evidence','') NOT LIKE '%made on internal SMT%';
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

  note:=' G65 PCBs are made on this internal SMT line. Other models'' named PCBs come from Starpro.';
  UPDATE pm.entities e SET data_json=(e.data_json::jsonb || jsonb_build_object('context',trim(coalesce(e.data_json::jsonb->>'context','')||note)))::text
  WHERE e.owner_id=selected_owner AND e.id=smt_id AND coalesce(e.data_json::jsonb->>'context','') NOT LIKE '%made on this internal SMT line%';
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
 END IF;

 IF starpro_id IS NOT NULL THEN
  note:=' Supplies the named PCBs for models other than G65. G65 PCBs stay on internal SMT.';
  UPDATE pm.entities e SET data_json=(e.data_json::jsonb || jsonb_build_object('context',trim(coalesce(e.data_json::jsonb->>'context','')||' '||note)))::text
  WHERE e.owner_id=selected_owner AND e.id=starpro_id AND coalesce(e.data_json::jsonb->>'context','') NOT LIKE '%models other than G65%';
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
 END IF;

 IF starpro_id IS NULL OR starpro_line_id IS NULL THEN
  IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
  RETURN;
 END IF;

 FOREACH part_name IN ARRAY ARRAY[
  'T1XL LH Upper PCB','T1XL LH Lower PCB','T1XL RH Upper PCB','T1XL RH Lower PCB',
  'BiLED · Big PCB','BL7m PE P · Big PCB','P768 A-2 · Big PCB'
 ] LOOP
  SELECT e.id INTO part_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=part_name
   ORDER BY e.rowid LIMIT 1;
  IF part_id IS NULL THEN CONTINUE; END IF;

  link_id:='origin-sup-'||substr(md5(starpro_id||'>'||part_id),1,16);
  INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
  SELECT selected_owner,link_id,'supplies',starpro_id,part_id,NULL,
   jsonb_build_object('id',link_id,'type','supplies','from',starpro_id,'to',part_id,'evidence','Owner 2026-10-18: PCBs for models other than G65 come from Starpro.')::text
  WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='supplies' AND r.from_id=starpro_id AND r.to_id=part_id);
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

  link_id:='origin-make-'||substr(md5(starpro_line_id||'>'||part_id),1,16);
  INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
  SELECT selected_owner,link_id,'produces',starpro_line_id,part_id,NULL,
   jsonb_build_object('id',link_id,'type','produces','from',starpro_line_id,'to',part_id,'evidence','Owner 2026-10-18: this PCB is made at Starpro SMT. G65 uses internal SMT instead. An in-house router cut, if recorded, is a later step.')::text
  WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='produces' AND r.from_id=starpro_line_id AND r.to_id=part_id);
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
 END LOOP;

 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
