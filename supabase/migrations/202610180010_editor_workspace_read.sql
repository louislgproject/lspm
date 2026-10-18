-- One database round trip for the editor workspace. The edge function only
-- arranges the JSON; it no longer opens a write lock to read.
CREATE FUNCTION pm.editor_workspace_parts()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'revision',(SELECT m.value FROM pm.meta m WHERE m.owner_id=p.owner_id AND m.key='revision'),
  'entities',COALESCE((SELECT jsonb_agg(e.data_json::jsonb ORDER BY e.rowid) FROM pm.entities e WHERE e.owner_id=p.owner_id),'[]'::jsonb),
  'relations',COALESCE((SELECT jsonb_agg(jsonb_build_object('data',r.data_json::jsonb,'scopeProjectId',r.scope_project_id) ORDER BY r.rowid) FROM pm.relations r WHERE r.owner_id=p.owner_id),'[]'::jsonb),
  'changes',COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',c.project_id,'change',c.data_json::jsonb) ORDER BY c.rowid) FROM pm.entity_changes c WHERE c.owner_id=p.owner_id),'[]'::jsonb),
  'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',m.project_id,'entityId',m.entity_id)) FROM pm.project_memberships m WHERE m.owner_id=p.owner_id),'[]'::jsonb),
  'assessments',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',a.project_id,'entityId',a.entity_id,'data',a.data_json::jsonb)) FROM pm.project_assessments a WHERE a.owner_id=p.owner_id),'[]'::jsonb),
  'schedules',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',s.project_id,'entityId',s.entity_id,'data',s.data_json::jsonb)) FROM pm.project_schedules s WHERE s.owner_id=p.owner_id),'[]'::jsonb),
  'lanes',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',w.project_id,'entityId',w.entity_id,'code',w.code) ORDER BY w.rowid) FROM pm.project_workstreams w WHERE w.owner_id=p.owner_id),'[]'::jsonb),
  'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'name',j.name,'status',j.status,'createdAt',j.created_at,'updatedAt',j.updated_at,'projectType',j.project_type) ORDER BY j.rowid) FROM pm.projects j WHERE j.owner_id=p.owner_id),'[]'::jsonb),
  'settings',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',v.project_id,'viewKey',v.view_key,'data',v.data_json::jsonb)) FROM pm.project_view_settings v WHERE v.owner_id=p.owner_id),'[]'::jsonb),
  'pending',(SELECT jsonb_build_object('id',c.id,'scope',c.scope,'recordedAt',c.recorded_at,'revision',c.revision,'items',c.items_json::jsonb,'acknowledgedAt',c.acknowledged_at,'revertedAt',c.reverted_at,'revertOf',c.revert_of) FROM pm.change_sets c WHERE c.owner_id=p.owner_id AND c.acknowledged_at IS NULL AND c.reverted_at IS NULL AND c.revert_of IS NULL ORDER BY c.rowid DESC LIMIT 1)
 ) FROM pm.publication p WHERE p.singleton=true
$$;
REVOKE ALL ON FUNCTION pm.editor_workspace_parts() FROM PUBLIC,anon,authenticated;
