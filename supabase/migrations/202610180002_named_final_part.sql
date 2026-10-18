-- Register only the final part explicitly named by the owner. Never invent all
-- IB/OB/RH/LH combinations or distribute historical parent-model quantities.
DO $$
DECLARE owner UUID; project TEXT; base JSONB; target TEXT:='ls-lq2-std-ib-rh'; link RECORD;
BEGIN
 SELECT owner_id INTO owner FROM pm.publication WHERE singleton=true;
 SELECT e.data_json::jsonb,m.project_id INTO base,project FROM pm.entities e
 JOIN pm.project_memberships m ON m.owner_id=e.owner_id AND m.entity_id=e.id
 JOIN pm.projects p ON p.owner_id=m.owner_id AND p.id=m.project_id
 WHERE e.owner_id=owner AND e.data_json::jsonb->>'name'='LQ2 STD' AND p.name='LS' LIMIT 1;
 IF base IS NULL OR EXISTS(SELECT 1 FROM pm.entities e WHERE e.owner_id=owner AND e.data_json::jsonb->>'name'='LQ2 STD IB RH') THEN RETURN; END IF;
 INSERT INTO pm.entities(owner_id,id,type,data_json) VALUES(owner,target,'Part',jsonb_build_object('id',target,'type','Part','name','LQ2 STD IB RH','status','active','itemKind','product','productionFamily',coalesce(base->>'productionFamily','LDM'),'productFamily',coalesce(base->>'productFamily','LQ2'),'inOut','IB','side','RH','context','Final-part identity requested by the workspace owner; historical parent quantities remain unallocated.')::text);
 INSERT INTO pm.project_memberships(owner_id,project_id,entity_id) VALUES(owner,project,target);
 INSERT INTO pm.project_workstreams(owner_id,project_id,entity_id,code) VALUES(owner,project,target,'production');
 INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
 VALUES(owner,'final-part-parent-'||target,'part_of',target,base->>'id',project,jsonb_build_object('id','final-part-parent-'||target,'type','part_of','from',target,'to',base->>'id','evidence','Workspace owner final-part classification')::text);
 FOR link IN SELECT r.from_id,r.data_json FROM pm.relations r WHERE r.owner_id=owner AND r.type='applies_to' AND r.to_id=base->>'id' AND (r.scope_project_id IS NULL OR r.scope_project_id=project) LOOP
  INSERT INTO pm.relations(owner_id,id,type,from_id,to_id,scope_project_id,data_json)
  VALUES(owner,'final-part-route-'||target||'-'||link.from_id,'applies_to',link.from_id,target,project,jsonb_build_object('id','final-part-route-'||target||'-'||link.from_id,'type','applies_to','from',link.from_id,'to',target,'evidence','Same existing LQ2 STD route; final-part measurement only')::text)
  ON CONFLICT(owner_id,id) DO NOTHING;
 END LOOP;
 UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=owner AND key='revision';
END $$;
