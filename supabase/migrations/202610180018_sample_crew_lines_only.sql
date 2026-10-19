-- The sample crew covers the line, not the unconfirmed reference machines.
DO $$
DECLARE selected_owner UUID; affected INTEGER;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 IF selected_owner IS NULL THEN RETURN; END IF;
 DELETE FROM pm.relations r
 USING pm.entities target
 WHERE r.owner_id=selected_owner AND target.owner_id=r.owner_id AND r.to_id=target.id
  AND r.type='qualified_for'
  AND r.data_json::jsonb->>'evidence' LIKE '%which subline is not recorded%'
  AND coalesce(target.data_json::jsonb->>'resourceKind','')<>'line';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
