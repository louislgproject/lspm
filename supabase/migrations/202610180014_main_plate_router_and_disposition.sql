-- Owner: the main plate is ICT, then Router splits it. G65 Outer is the RH
-- Jewelry piece. Cornering and Side Marker hands get the same NG/Scrap steps
-- as the other hands. SMT templates and Cornering/Side Marker piece usage stay notes.
DO $$
DECLARE
 selected_owner UUID; selected_project TEXT; spec RECORD; step_id TEXT; part_id TEXT; family_id TEXT;
 link_id TEXT; changed INTEGER:=0; affected INTEGER; note TEXT;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 SELECT p.id INTO selected_project FROM pm.projects p WHERE p.owner_id=selected_owner AND p.name='LS' AND p.status='active' LIMIT 1;
 IF selected_project IS NULL THEN RETURN; END IF;

 UPDATE pm.relations r SET to_id=jewelry.id,
  data_json=(r.data_json::jsonb || jsonb_build_object('to',jewelry.id,'evidence','Owner: G65 Outer is G65 Jewelry Piece RH, the Router output of the main plate.'))::text
 FROM pm.entities router, pm.entities outer_part, pm.entities jewelry
 WHERE r.owner_id=selected_owner AND r.type='produces' AND r.from_id=router.id AND r.to_id=outer_part.id
  AND router.owner_id=selected_owner AND outer_part.owner_id=selected_owner AND jewelry.owner_id=selected_owner
  AND router.data_json::jsonb->>'name'='G65 main (route label) · Router'
  AND outer_part.data_json::jsonb->>'name'='G65 Outer (RH Router output)'
  AND jewelry.data_json::jsonb->>'name'='G65 Jewelry Piece RH';
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 UPDATE pm.entities e SET data_json=(e.data_json::jsonb || jsonb_build_object(
  'status','archived','mappingState','retired_variant','replacedByPartId',jewelry.id,
  'context','Same part as G65 Jewelry Piece RH. This name was the RH Router output of the main plate.'
 ))::text
 FROM pm.entities jewelry
 WHERE e.owner_id=selected_owner AND jewelry.owner_id=selected_owner
  AND e.data_json::jsonb->>'name'='G65 Outer (RH Router output)' AND e.data_json::jsonb->>'status' IS DISTINCT FROM 'archived'
  AND jewelry.data_json::jsonb->>'name'='G65 Jewelry Piece RH';
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 UPDATE pm.entities e SET data_json=(e.data_json::jsonb || jsonb_build_object(
  'context','Before Router. ICT runs on this plate, then Router splits it. Not a shipped output.'
 ))::text
 WHERE e.owner_id=selected_owner AND e.data_json::jsonb->>'name' IN ('G65 Main Plate RH','G65 Main Plate LH')
  AND coalesce(e.data_json::jsonb->>'context','') NOT LIKE 'Before Router.%';
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 UPDATE pm.entities e SET data_json=(e.data_json::jsonb || jsonb_build_object(
  'context',trim(coalesce(e.data_json::jsonb->>'context','')||' This is the RH Router output previously called G65 Outer.')
 ))::text
 WHERE e.owner_id=selected_owner AND e.data_json::jsonb->>'name'='G65 Jewelry Piece RH'
  AND coalesce(e.data_json::jsonb->>'context','') NOT LIKE '%previously called G65 Outer%';
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 SELECT e.id INTO family_id FROM pm.entities e
  JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
  WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.data_json::jsonb->>'name'='G65' AND e.type='Part'
  ORDER BY e.rowid LIMIT 1;

 FOR spec IN SELECT * FROM (VALUES
  ('G65 main (route label) · ICT','G65 Main Plate RH','applies_to'),
  ('G65 main (route label) · ICT','G65 Main Plate LH','applies_to'),
  ('G65 main (route label) · Router','G65 Main Plate LH','consumes')
 ) AS v(step_name,part_name,rel_type) LOOP
  SELECT e.id INTO step_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Production Step' AND e.data_json::jsonb->>'name'=spec.step_name ORDER BY e.rowid LIMIT 1;
  SELECT e.id INTO part_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec.part_name ORDER BY e.rowid LIMIT 1;
  IF step_id IS NULL OR part_id IS NULL THEN CONTINUE; END IF;
  link_id:='plate-'||substr(md5(step_id||spec.rel_type||part_id),1,20);
  INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
  SELECT selected_owner,link_id,spec.rel_type,step_id,part_id,NULL,
   CASE WHEN spec.rel_type='consumes' THEN
    jsonb_build_object('id',link_id,'type',spec.rel_type,'from',step_id,'to',part_id,'quantity',1,'unit','piece','routePartId','ls-part-g65-main','evidence','Owner: ICT is performed on the main plate, then Router splits it.')
   ELSE
    jsonb_build_object('id',link_id,'type',spec.rel_type,'from',step_id,'to',part_id,'evidence','Owner: ICT is performed on the main plate, then Router splits it.')
   END::text
  WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type=spec.rel_type AND r.from_id=step_id AND r.to_id=part_id);
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
  IF family_id IS NOT NULL AND spec.rel_type='applies_to' THEN
   link_id:='hier-of-'||substr(md5(part_id||'>'||family_id),1,20);
   INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
   SELECT selected_owner,link_id,'part_of',part_id,family_id,NULL,
    jsonb_build_object('id',link_id,'type','part_of','from',part_id,'to',family_id,'evidence','Pre-router plate for this family. Not a shipped output.')::text
   WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='part_of' AND r.from_id=part_id AND r.to_id=family_id);
   GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
  END IF;
 END LOOP;

 FOR spec IN SELECT * FROM (VALUES
  ('NG storage','G65 Cornering LH'),('Scrap','G65 Cornering LH'),
  ('NG storage','G65 Cornering RH'),('Scrap','G65 Cornering RH'),
  ('NG storage','G65 Side Marker LH'),('Scrap','G65 Side Marker LH'),
  ('NG storage','G65 Side Marker RH'),('Scrap','G65 Side Marker RH')
 ) AS v(step_name,part_name) LOOP
  SELECT e.id INTO step_id FROM pm.entities e WHERE e.owner_id=selected_owner AND e.type='Production Step' AND e.data_json::jsonb->>'name'=spec.step_name ORDER BY e.rowid LIMIT 1;
  SELECT e.id INTO part_id FROM pm.entities e
   JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
   WHERE e.owner_id=selected_owner AND m.project_id=selected_project AND e.type='Part' AND e.data_json::jsonb->>'name'=spec.part_name ORDER BY e.rowid LIMIT 1;
  IF step_id IS NULL OR part_id IS NULL THEN CONTINUE; END IF;
  link_id:='disp-'||substr(md5(step_id||'>'||part_id),1,20);
  INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
  SELECT selected_owner,link_id,'applies_to',step_id,part_id,NULL,
   jsonb_build_object('id',link_id,'type','applies_to','from',step_id,'to',part_id,'evidence','Owner: NG storage and Scrap apply to these hands, as they do to Upper and Lower.')::text
  WHERE NOT EXISTS(SELECT 1 FROM pm.relations r WHERE r.owner_id=selected_owner AND r.type='applies_to' AND r.from_id=step_id AND r.to_id=part_id);
  GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;
 END LOOP;

 note:=' Note 2026-10-18: leave unattached until the owner confirms which part uses this template.';
 UPDATE pm.entities e SET data_json=(e.data_json::jsonb || jsonb_build_object('context',trim(coalesce(e.data_json::jsonb->>'context','')||note)))::text
 WHERE e.owner_id=selected_owner AND e.type='Production Step'
  AND e.data_json::jsonb->>'name' ~ '^(TEM SMT template|Internal SMT|Starpro SMT|TEM reference) ·'
  AND coalesce(e.data_json::jsonb->>'context','') NOT LIKE '%'||trim(note)||'%';
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 note:=' Note 2026-10-18: not tied to a consuming step yet. LAM assembly is only a candidate.';
 UPDATE pm.entities e SET data_json=(e.data_json::jsonb || jsonb_build_object('context',trim(coalesce(e.data_json::jsonb->>'context','')||note)))::text
 FROM pm.project_memberships m
 WHERE e.owner_id=selected_owner AND m.owner_id=e.owner_id AND m.entity_id=e.id AND m.project_id=selected_project
  AND e.type='Part' AND e.data_json::jsonb->>'name' ~ '^G65 (Cornering|Side Marker) (LH|RH) '
  AND coalesce(e.data_json::jsonb->>'context','') NOT LIKE '%'||trim(note)||'%';
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
