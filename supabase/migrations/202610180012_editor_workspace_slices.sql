-- Project names load without the graph. One opened project loads only its own rows.
CREATE FUNCTION pm.editor_workspace_summary()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'revision',(SELECT m.value::integer FROM pm.meta m WHERE m.owner_id=p.owner_id AND m.key='revision'),
  'catalogOnly',true,
  'library',jsonb_build_object('id','library','name','Global Library','status','active','version',2,'entities','[]'::jsonb,'relations','[]'::jsonb,'changes','[]'::jsonb,'entityCount',(SELECT count(*) FROM pm.entities e WHERE e.owner_id=p.owner_id)),
  'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',j.id,'name',j.name,'status',j.status,'createdAt',j.created_at,'updatedAt',j.updated_at,'version',2,'projectType',j.project_type,
    'loaded',false,'entityCount',(SELECT count(*) FROM pm.project_memberships n WHERE n.owner_id=j.owner_id AND n.project_id=j.id),
    'entities','[]'::jsonb,'relations','[]'::jsonb,'changes','[]'::jsonb,'workstreams','{}'::jsonb
  ) ORDER BY j.rowid) FROM pm.projects j WHERE j.owner_id=p.owner_id),'[]'::jsonb),
  'viewSettings',COALESCE((SELECT jsonb_object_agg(s.project_id,s.settings) FROM (
    SELECT v.project_id,jsonb_object_agg(v.view_key,v.data_json::jsonb) AS settings FROM pm.project_view_settings v WHERE v.owner_id=p.owner_id GROUP BY v.project_id
  ) s),'{}'::jsonb),
  'pendingChange',(SELECT jsonb_build_object('id',c.id,'scope',c.scope,'recordedAt',c.recorded_at,'revision',c.revision,'items',c.items_json::jsonb,'acknowledgedAt',c.acknowledged_at,'revertedAt',c.reverted_at,'revertOf',c.revert_of) FROM pm.change_sets c WHERE c.owner_id=p.owner_id AND c.acknowledged_at IS NULL AND c.reverted_at IS NULL AND c.revert_of IS NULL ORDER BY c.rowid DESC LIMIT 1)
 ) FROM pm.publication p WHERE p.singleton=true
$$;

CREATE FUNCTION pm.editor_workspace_project(requested TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM pm.projects j WHERE j.owner_id=p.owner_id AND j.id=requested) THEN jsonb_build_object(
  'revision',(SELECT m.value FROM pm.meta m WHERE m.owner_id=p.owner_id AND m.key='revision'),
  'entities',COALESCE((SELECT jsonb_agg(e.data_json::jsonb ORDER BY e.rowid) FROM pm.entities e WHERE e.owner_id=p.owner_id AND EXISTS(SELECT 1 FROM pm.project_memberships n WHERE n.owner_id=e.owner_id AND n.project_id=requested AND n.entity_id=e.id)),'[]'::jsonb),
  'relations',COALESCE((SELECT jsonb_agg(jsonb_build_object('data',r.data_json::jsonb,'scopeProjectId',r.scope_project_id) ORDER BY r.rowid) FROM pm.relations r WHERE r.owner_id=p.owner_id AND EXISTS(SELECT 1 FROM pm.project_memberships a WHERE a.owner_id=r.owner_id AND a.project_id=requested AND a.entity_id=r.from_id) AND EXISTS(SELECT 1 FROM pm.project_memberships b WHERE b.owner_id=r.owner_id AND b.project_id=requested AND b.entity_id=r.to_id)),'[]'::jsonb),
  'changes',COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',c.project_id,'change',c.data_json::jsonb) ORDER BY c.rowid) FROM pm.entity_changes c WHERE c.owner_id=p.owner_id AND (c.project_id IS NULL OR c.project_id=requested) AND EXISTS(SELECT 1 FROM pm.project_memberships n WHERE n.owner_id=c.owner_id AND n.project_id=requested AND n.entity_id=c.entity_id)),'[]'::jsonb),
  'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',n.project_id,'entityId',n.entity_id)) FROM pm.project_memberships n WHERE n.owner_id=p.owner_id AND n.project_id=requested),'[]'::jsonb),
  'assessments',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',a.project_id,'entityId',a.entity_id,'data',a.data_json::jsonb)) FROM pm.project_assessments a WHERE a.owner_id=p.owner_id AND a.project_id=requested),'[]'::jsonb),
  'schedules',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',s.project_id,'entityId',s.entity_id,'data',s.data_json::jsonb)) FROM pm.project_schedules s WHERE s.owner_id=p.owner_id AND s.project_id=requested),'[]'::jsonb),
  'lanes',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',w.project_id,'entityId',w.entity_id,'code',w.code) ORDER BY w.rowid) FROM pm.project_workstreams w WHERE w.owner_id=p.owner_id AND w.project_id=requested),'[]'::jsonb),
  'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'name',j.name,'status',j.status,'createdAt',j.created_at,'updatedAt',j.updated_at,'projectType',j.project_type) ORDER BY j.rowid) FROM pm.projects j WHERE j.owner_id=p.owner_id),'[]'::jsonb),
  'settings',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',v.project_id,'viewKey',v.view_key,'data',v.data_json::jsonb)) FROM pm.project_view_settings v WHERE v.owner_id=p.owner_id),'[]'::jsonb),
  'pending',(SELECT jsonb_build_object('id',c.id,'scope',c.scope,'recordedAt',c.recorded_at,'revision',c.revision,'items',c.items_json::jsonb,'acknowledgedAt',c.acknowledged_at,'revertedAt',c.reverted_at,'revertOf',c.revert_of) FROM pm.change_sets c WHERE c.owner_id=p.owner_id AND c.acknowledged_at IS NULL AND c.reverted_at IS NULL AND c.revert_of IS NULL ORDER BY c.rowid DESC LIMIT 1)
 ) ELSE NULL END FROM pm.publication p WHERE p.singleton=true
$$;

REVOKE ALL ON FUNCTION pm.editor_workspace_summary() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION pm.editor_workspace_project(TEXT) FROM PUBLIC,anon,authenticated;
