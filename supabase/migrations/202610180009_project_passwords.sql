-- One temporary password for every project view. The master edit password is
-- separate and already checks the same value. Re-running this does nothing
-- once a project already accepts 7777777.
DO $$
DECLARE selected_owner UUID; proj RECORD; hash TEXT; changed INTEGER:=0;
BEGIN
 SELECT owner_id INTO selected_owner FROM pm.publication WHERE singleton=true;
 IF selected_owner IS NULL THEN RETURN; END IF;
 hash:=extensions.crypt('7777777',extensions.gen_salt('bf',10));
 FOR proj IN SELECT id FROM pm.projects WHERE owner_id=selected_owner LOOP
  IF EXISTS(SELECT 1 FROM pm.project_access a WHERE a.owner_id=selected_owner AND a.project_id=proj.id AND a.visibility='password' AND a.password_hash=extensions.crypt('7777777',a.password_hash)) THEN CONTINUE; END IF;
  INSERT INTO pm.project_access(owner_id,project_id,visibility,password_hash)
  VALUES(selected_owner,proj.id,'password',hash)
  ON CONFLICT ON CONSTRAINT project_access_pkey DO UPDATE SET visibility='password',password_hash=excluded.password_hash,generation=gen_random_uuid(),attempts=0,attempt_window=now();
  DELETE FROM pm.project_view_sessions s WHERE s.owner_id=selected_owner AND s.project_id=proj.id;
  changed:=changed+1;
 END LOOP;
 IF changed>0 THEN UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=selected_owner AND key='revision'; END IF;
END $$;
