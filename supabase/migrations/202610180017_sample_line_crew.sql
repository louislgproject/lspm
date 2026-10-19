-- Owner: the people already on a process line also do that line's sample work.
-- This is line coverage, not a named station, shift, or subline split.
DO $$
DECLARE
 selected_owner UUID; changed INTEGER:=0; affected INTEGER; note TEXT;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 IF selected_owner IS NULL THEN RETURN; END IF;

 INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
 SELECT DISTINCT selected_owner,
  'crew-'||substr(md5(person.id||'>'||step.id),1,20),
  'qualified_for', person.id, step.id, NULL,
  jsonb_build_object(
   'id','crew-'||substr(md5(person.id||'>'||step.id),1,20),
   'type','qualified_for','from',person.id,'to',step.id,
   'evidence','Owner 2026-10-18: the people on this process line also do its sample work. Line coverage only; no named station, shift, or subline split.'
  )::text
 FROM pm.relations crew
 JOIN pm.entities person ON person.owner_id=crew.owner_id AND person.id=crew.from_id AND person.type='Person'
 JOIN pm.entities line ON line.owner_id=crew.owner_id AND line.id=crew.to_id AND line.type='Resource' AND line.data_json::jsonb->>'name' IN ('LDM','TEM','SMT')
 JOIN pm.relations run ON run.owner_id=crew.owner_id AND run.type='operated_in'
 JOIN pm.entities step ON step.owner_id=run.owner_id AND step.id=run.from_id AND step.type='Production Step'
 JOIN pm.entities place ON place.owner_id=run.owner_id AND place.id=run.to_id
 JOIN pm.project_memberships member ON member.owner_id=step.owner_id AND member.entity_id=step.id
 JOIN pm.projects sample ON sample.owner_id=member.owner_id AND sample.id=member.project_id AND sample.project_type='sample' AND sample.status='active'
 WHERE crew.owner_id=selected_owner AND crew.type IN ('works_on','manages')
  AND step.data_json::jsonb->>'name' NOT LIKE 'TEM reference%'
  AND (
   place.id=line.id
   OR EXISTS (
    SELECT 1 FROM pm.relations parent
    WHERE parent.owner_id=crew.owner_id AND parent.type='part_of' AND parent.from_id=place.id AND parent.to_id=line.id
   )
  )
  AND NOT EXISTS (
   SELECT 1 FROM pm.relations old
   WHERE old.owner_id=selected_owner AND old.type='qualified_for' AND old.from_id=person.id AND old.to_id=step.id
  );
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
 SELECT DISTINCT selected_owner,
  'crew-line-'||substr(md5(person.id||'>'||subline.id),1,16),
  'qualified_for', person.id, subline.id, NULL,
  jsonb_build_object(
   'id','crew-line-'||substr(md5(person.id||'>'||subline.id),1,16),
   'type','qualified_for','from',person.id,'to',subline.id,
   'evidence','Owner 2026-10-18: this line crew also runs the sample on its sublines. Which person stands on which subline is not recorded.'
  )::text
 FROM pm.relations crew
 JOIN pm.entities person ON person.owner_id=crew.owner_id AND person.id=crew.from_id AND person.type='Person'
 JOIN pm.entities line ON line.owner_id=crew.owner_id AND line.id=crew.to_id AND line.type='Resource' AND line.data_json::jsonb->>'name' IN ('LDM','TEM','SMT')
 JOIN pm.relations child ON child.owner_id=crew.owner_id AND child.type='part_of' AND child.to_id=line.id
 JOIN pm.entities subline ON subline.owner_id=child.owner_id AND subline.id=child.from_id AND subline.type='Resource'
 JOIN pm.project_memberships member ON member.owner_id=subline.owner_id AND member.entity_id=subline.id
 JOIN pm.projects sample ON sample.owner_id=member.owner_id AND sample.id=member.project_id AND sample.project_type='sample' AND sample.status='active'
 WHERE crew.owner_id=selected_owner AND crew.type IN ('works_on','manages')
  AND NOT EXISTS (
   SELECT 1 FROM pm.relations old
   WHERE old.owner_id=selected_owner AND old.type='qualified_for' AND old.from_id=person.id AND old.to_id=subline.id
  );
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 note:=' The same crew also does this line''s sample work. Individual station and subline assignment is not recorded.';
 UPDATE pm.entities e SET data_json=(e.data_json::jsonb || jsonb_build_object('context',trim(coalesce(e.data_json::jsonb->>'context','')||note)))::text
 WHERE e.owner_id=selected_owner AND e.type='Resource' AND e.data_json::jsonb->>'name' IN ('LDM','TEM','SMT')
  AND coalesce(e.data_json::jsonb->>'context','') NOT LIKE '%also does this line%';
 GET DIAGNOSTICS affected=ROW_COUNT; changed:=changed+affected;

 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
