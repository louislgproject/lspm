-- Project visibility is enforced for both Edge and direct Data API requests.
CREATE TABLE pm.project_access (
 owner_id UUID NOT NULL DEFAULT auth.uid(), project_id TEXT NOT NULL,
 visibility TEXT NOT NULL CHECK(visibility IN ('public','password','private')),
 password_hash TEXT, generation UUID NOT NULL DEFAULT gen_random_uuid(),
 attempts INTEGER NOT NULL DEFAULT 0, attempt_window TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,project_id),
 FOREIGN KEY(owner_id,project_id) REFERENCES pm.projects(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE pm.project_view_sessions (
 token_hash TEXT PRIMARY KEY,owner_id UUID NOT NULL,project_id TEXT NOT NULL,
 generation UUID NOT NULL,expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE pm.project_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm.project_view_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pm.project_access,pm.project_view_sessions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pm_set_project_access(project_id TEXT,visibility TEXT,password TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE owner UUID:=auth.uid(); stored TEXT;
BEGIN
 IF owner IS NULL OR NOT EXISTS(SELECT 1 FROM pm.projects p WHERE p.owner_id=owner AND p.id=project_id) THEN RAISE EXCEPTION 'Unknown project.'; END IF;
 IF visibility NOT IN ('public','password','private') THEN RAISE EXCEPTION 'Invalid visibility.'; END IF;
 IF visibility='password' THEN
  IF length(password)>72 THEN RAISE EXCEPTION 'Password must be at most 72 characters.'; END IF;
  IF password='' THEN
   SELECT a.password_hash INTO stored FROM pm.project_access a WHERE a.owner_id=owner AND a.project_id=pm_set_project_access.project_id AND a.visibility='password';
   IF stored IS NULL THEN RAISE EXCEPTION 'Enter a password of at least 4 characters.'; END IF;
  ELSE
   IF length(password)<4 OR octet_length(password)>72 THEN RAISE EXCEPTION 'Password must be 4 to 72 bytes.'; END IF;
   stored:=extensions.crypt(password,extensions.gen_salt('bf',10));
  END IF;
 END IF;
 INSERT INTO pm.project_access(owner_id,project_id,visibility,password_hash) VALUES(owner,project_id,visibility,stored)
 ON CONFLICT ON CONSTRAINT project_access_pkey DO UPDATE SET visibility=excluded.visibility,password_hash=excluded.password_hash,generation=gen_random_uuid(),attempts=0,attempt_window=now();
 DELETE FROM pm.project_view_sessions s WHERE s.owner_id=owner AND s.project_id=pm_set_project_access.project_id;
 UPDATE pm.meta SET value=(value::integer+1)::text WHERE owner_id=owner AND key='revision';
 RETURN jsonb_build_object('visibility',visibility);
END $$;
CREATE FUNCTION public.pm_get_project_access(project_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pm.projects p WHERE p.owner_id=auth.uid() AND p.id=project_id) THEN RAISE EXCEPTION 'Unknown project.'; END IF;
 RETURN jsonb_build_object('visibility',coalesce((SELECT a.visibility FROM pm.project_access a WHERE a.owner_id=auth.uid() AND a.project_id=pm_get_project_access.project_id),'public'));
END $$;
REVOKE ALL ON FUNCTION public.pm_set_project_access(TEXT,TEXT,TEXT),public.pm_get_project_access(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pm_set_project_access(TEXT,TEXT,TEXT),public.pm_get_project_access(TEXT) TO authenticated;

CREATE FUNCTION public.pm_unlock_project(project_id TEXT,password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE owner UUID; a pm.project_access; token TEXT;
BEGIN
 SELECT p.owner_id INTO owner FROM pm.publication p WHERE singleton=true;
 SELECT * INTO a FROM pm.project_access s WHERE s.owner_id=owner AND s.project_id=pm_unlock_project.project_id FOR UPDATE;
 IF a.visibility IS DISTINCT FROM 'password' OR password IS NULL OR length(password)<4 OR octet_length(password)>72 THEN RETURN jsonb_build_object('error','Invalid project or password.'); END IF;
 IF a.attempt_window<now()-interval '1 minute' THEN a.attempts:=0; a.attempt_window:=now(); END IF;
 IF a.attempts>=10 THEN RETURN jsonb_build_object('error','Too many attempts. Try again in one minute.'); END IF;
 UPDATE pm.project_access SET attempts=a.attempts+1,attempt_window=a.attempt_window WHERE owner_id=owner AND project_access.project_id=pm_unlock_project.project_id;
 IF a.password_hash<>extensions.crypt(password,a.password_hash) THEN RETURN jsonb_build_object('error','Invalid project or password.'); END IF;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 DELETE FROM pm.project_view_sessions WHERE expires_at<now();
 INSERT INTO pm.project_view_sessions VALUES(encode(extensions.digest(token,'sha256'),'hex'),owner,project_id,a.generation,now()+interval '8 hours');
 RETURN jsonb_build_object('token',token);
END $$;
REVOKE ALL ON FUNCTION public.pm_unlock_project(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pm_unlock_project(TEXT,TEXT) TO anon,authenticated;

CREATE FUNCTION pm.project_visible(owner UUID,project_id TEXT,view_tokens TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT a.visibility='public' OR a.visibility='password' AND EXISTS(
  SELECT 1 FROM pm.project_view_sessions s WHERE s.owner_id=a.owner_id AND s.project_id=a.project_id AND s.generation=a.generation AND s.expires_at>now()
  AND s.token_hash IN (SELECT encode(extensions.digest(t,'sha256'),'hex') FROM unnest(string_to_array(left(view_tokens,1300),',')) t)
 ) FROM pm.project_access a WHERE a.owner_id=owner AND a.project_id=project_visible.project_id),true)
$$;
CREATE FUNCTION pm.public_entity_visible(owner UUID,entity_id TEXT,view_tokens TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM pm.entities e WHERE e.owner_id=owner AND e.id=entity_id AND coalesce(e.data_json::jsonb->>'privacy','')<>'local_only')
 AND (NOT EXISTS(SELECT 1 FROM pm.project_memberships m WHERE m.owner_id=owner AND m.entity_id=public_entity_visible.entity_id)
 OR EXISTS(SELECT 1 FROM pm.project_memberships m WHERE m.owner_id=owner AND m.entity_id=public_entity_visible.entity_id AND pm.project_visible(owner,m.project_id,view_tokens)))
$$;
CREATE FUNCTION pm.filter_public_graph(graph JSONB,owner UUID,view_tokens TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path='' AS $$
#variable_conflict use_variable
DECLARE entities JSONB; ids TEXT[]; relations JSONB;
BEGIN
 SELECT coalesce(jsonb_agg(e),'[]'::jsonb),coalesce(array_agg(e->>'id'),ARRAY[]::text[]) INTO entities,ids FROM jsonb_array_elements(graph->'entities') e WHERE coalesce(e->>'privacy','')<>'local_only' AND pm.public_entity_visible(owner,e->>'id',view_tokens);
 SELECT coalesce(jsonb_agg(r),'[]'::jsonb) INTO relations FROM jsonb_array_elements(graph->'relations') r WHERE r->>'from'=ANY(ids) AND r->>'to'=ANY(ids) AND (nullif(r->>'scopeProjectId','') IS NULL OR pm.project_visible(owner,r->>'scopeProjectId',view_tokens));
 RETURN graph||jsonb_build_object('entities',entities,'relations',relations,'workstreams',coalesce((SELECT jsonb_object_agg(k,v) FROM jsonb_each(coalesce(graph->'workstreams','{}'::jsonb)) x(k,v) WHERE k=ANY(ids)),'{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION pm.project_visible(UUID,TEXT,TEXT),pm.public_entity_visible(UUID,TEXT,TEXT),pm.filter_public_graph(JSONB,UUID,TEXT) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION public.pm_public_read(TEXT,TEXT,TEXT) SET SCHEMA pm;
ALTER FUNCTION public.pm_public_production_read(TEXT,TEXT) SET SCHEMA pm;
REVOKE ALL ON FUNCTION pm.pm_public_read(TEXT,TEXT,TEXT),pm.pm_public_production_read(TEXT,TEXT) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pm_public_read(operation TEXT,project_id TEXT DEFAULT '',snapshot_id TEXT DEFAULT '',view_tokens TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE owner UUID; result JSONB; p JSONB; projects JSONB:='[]'; allowed TEXT[]:=ARRAY[]::TEXT[]; settings JSONB;
BEGIN
 SELECT pub.owner_id INTO owner FROM pm.publication pub WHERE singleton=true;
 IF operation NOT IN ('workspace','health') AND NOT pm.project_visible(owner,project_id,view_tokens) THEN RAISE EXCEPTION 'Project access required.'; END IF;
 result:=pm.pm_public_read(operation,project_id,snapshot_id);
 IF operation<>'workspace' THEN RETURN result; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(result->'projects') LOOP
  IF pm.project_visible(owner,p->>'id',view_tokens) THEN
   allowed:=array_append(allowed,p->>'id'); projects:=projects||jsonb_build_array(pm.filter_public_graph(p,owner,view_tokens));
  ELSIF EXISTS(SELECT 1 FROM pm.project_access a WHERE a.owner_id=owner AND a.project_id=p->>'id' AND a.visibility='password') THEN
   projects:=projects||jsonb_build_array(jsonb_build_object('id',p->'id','name',p->'name','status',p->'status','viewPending',true,'visibility','password','entities','[]'::jsonb,'relations','[]'::jsonb,'changes','[]'::jsonb));
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_object_agg(k,v),'{}'::jsonb) INTO settings FROM jsonb_each(result->'viewSettings') x(k,v) WHERE k=ANY(allowed) OR k='library';
 -- Library view preferences can contain private grouping labels and IDs.
 IF EXISTS(SELECT 1 FROM pm.project_access a WHERE a.owner_id=owner AND NOT pm.project_visible(owner,a.project_id,view_tokens)) THEN settings:=settings-'library'; END IF;
 RETURN result||jsonb_build_object('library',pm.filter_public_graph(result->'library',owner,view_tokens)-'workstreams','projects',projects,'viewSettings',settings);
END $$;
CREATE FUNCTION public.pm_public_production_read(operation TEXT,project_id TEXT DEFAULT '',view_tokens TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE owner UUID;
BEGIN
 SELECT p.owner_id INTO owner FROM pm.publication p WHERE singleton=true;
 IF NOT pm.project_visible(owner,project_id,view_tokens) THEN RAISE EXCEPTION 'Project access required.'; END IF;
 RETURN pm.pm_public_production_read(operation,project_id);
END $$;
REVOKE ALL ON FUNCTION public.pm_public_read(TEXT,TEXT,TEXT,TEXT),public.pm_public_production_read(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pm_public_read(TEXT,TEXT,TEXT,TEXT),public.pm_public_production_read(TEXT,TEXT,TEXT) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
