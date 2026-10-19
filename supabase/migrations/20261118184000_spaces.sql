-- Spaces own all knowledge, processing state, settings and AI memory. Profiles
-- and the fixed entity-type vocabulary remain account/system-level records.
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  check (owner_id is not null or id = '00000000-0000-4000-8000-000000000001')
);
insert into public.spaces(id, owner_id, name)
values ('00000000-0000-4000-8000-000000000001', (select u.id from auth.users u order by coalesce(to_jsonb(u)->>'created_at',''),u.id limit 1), 'My Space');
alter table public.spaces enable row level security;
grant select on public.spaces to authenticated;
create policy spaces_read on public.spaces for select to authenticated using (owner_id = auth.uid());

-- A non-bypass role also owns existing SECURITY DEFINER knowledge functions.
-- Otherwise those functions would silently escape the space policies.
create role space_runtime nologin nobypassrls;
grant usage on schema public, change_control, auth, extensions to space_runtime;
grant execute on all functions in schema auth to space_runtime;
grant space_runtime to service_role;
do $$ begin execute format('grant space_runtime to %I',current_user); end $$;

create function public.current_space_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  person uuid := auth.uid();
  selected uuid := nullif(h->>'x-space-id', '')::uuid;
  result uuid;
begin
  if claims->>'role' = 'service_role' then person := nullif(h->>'x-person-id', '')::uuid; end if;
  -- Trusted scripts and the legacy capture key keep targeting the original space.
  if person is null and (claims->>'role' = 'service_role' or claims = '{}') then
    return coalesce(selected, '00000000-0000-4000-8000-000000000001'::uuid);
  end if;
  if person is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select s.id into result from public.spaces s
  where s.owner_id = person and (selected is null or s.id = selected)
  order by s.created_at, s.id limit 1;
  if result is null then raise exception 'Space not found or not owned by you' using errcode = '42501'; end if;
  return result;
end $$;

-- Realtime evaluates SELECT policies with a JWT but without HTTP headers.
-- It can deliver only records owned by that subscriber. HTTP reads additionally
-- require the selected space; the client filters Realtime invalidations by it.
create function public.space_read_allowed(p_space uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when nullif(current_setting('request.headers',true),'') is null
    then exists(select 1 from public.spaces where id=p_space and owner_id=auth.uid())
    else p_space=public.current_space_id() end
$$;

-- Store FK definitions before replacing uniqueness. Composite FKs make it
-- impossible to link an article, source, claim or job into another space.
create temporary table space_fks as
select c.conrelid, c.conname, c.confrelid, pg_get_constraintdef(c.oid) definition
from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_class r on r.oid=c.confrelid
where c.contype='f' and t.relnamespace='public'::regnamespace and r.relnamespace='public'::regnamespace
  and t.relname not in ('profiles','spaces','entity_types') and r.relname not in ('profiles','spaces','entity_types');

do $$ declare t record; c record; cols text; definition text; mergejoin text := current_setting('enable_mergejoin'); begin
  -- OrioleDB's merge-join validation of newly built composite FK indexes can
  -- report "mergejoin input data is out of order". Validate with hash/nested joins.
  perform set_config('enable_mergejoin','off',true);
  for c in select * from space_fks loop
    execute format('alter table %s drop constraint %I', c.conrelid::regclass,c.conname);
  end loop;
  for t in select oid,relname from pg_class where relnamespace='public'::regnamespace and relkind='r'
    and relname not in ('profiles','spaces','entity_types') loop
    execute format('alter table public.%I add column space_id uuid not null default ''00000000-0000-4000-8000-000000000001'' references public.spaces(id)',t.relname);
    execute format('alter table public.%I alter column space_id set default public.current_space_id()',t.relname);
    execute format('create index %I on public.%I(space_id)',t.relname||'_space_idx',t.relname);
    for c in select x.*,pg_get_constraintdef(x.oid) definition from pg_constraint x where conrelid=t.oid and contype in ('p','u') loop
      select string_agg(quote_ident(a.attname),', ' order by k.n) into cols
        from unnest(c.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum;
      -- UUID identifiers remain globally unique for URLs and Realtime identity.
      if c.contype='p' and t.relname<>'domain_tabs' and array_length(c.conkey,1)=1 and exists(select 1 from pg_attribute where attrelid=t.oid and attnum=c.conkey[1] and atttypid='uuid'::regtype) then
        execute format('alter table public.%I add constraint %I unique(space_id,%s)',t.relname,t.relname||'_space_identity',cols);
      else
        execute format('alter table public.%I drop constraint %I',t.relname,c.conname);
        definition := regexp_replace(c.definition,'\(', '(space_id, ');
        execute format('alter table public.%I add constraint %I %s',t.relname,c.conname,definition);
      end if;
    end loop;
    -- Include partial/expression indexes (skill names, active runs, logos).
    for c in select i.indexrelid,pg_get_indexdef(i.indexrelid) definition from pg_index i
      where i.indrelid=t.oid and i.indisunique and not exists(select 1 from pg_constraint where conindid=i.indexrelid) loop
      definition := regexp_replace(c.definition,'USING btree \(', 'USING btree (space_id, ');
      execute format('drop index %s',c.indexrelid::regclass);
      execute definition;
    end loop;
    execute format('alter table public.%I enable row level security',t.relname);
    execute format('create policy space_boundary on public.%I as restrictive for all to space_runtime using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()))',t.relname);
    execute format('create policy space_browser_boundary on public.%I as restrictive for all to authenticated using (public.space_read_allowed(space_id)) with check (false)',t.relname);
    execute format('create policy space_server on public.%I for all to space_runtime using (true) with check (true)',t.relname);
    execute format('grant select,insert,update,delete on public.%I to space_runtime',t.relname);
  end loop;
  for c in select * from space_fks loop
    definition := regexp_replace(c.definition,'FOREIGN KEY \(([^)]+)\) REFERENCES ([^(]+)\(([^)]+)\)', 'FOREIGN KEY (space_id, \1) REFERENCES \2(space_id, \3)');
    -- SET NULL must leave the required space identifier intact.
    if definition like '%ON DELETE SET NULL%' then
      cols := substring(c.definition from 'FOREIGN KEY \(([^)]+)\)');
      definition := replace(definition,'ON DELETE SET NULL','ON DELETE SET NULL ('||cols||')');
    end if;
    execute format('alter table %s add constraint %I %s',c.conrelid::regclass,c.conname,definition);
  end loop;
  perform set_config('enable_mergejoin',mergejoin,true);
end $$;
drop table space_fks;

-- Existing RPCs now upsert against the selected space's uniqueness. Keep this
-- mechanical adaptation in one migration so older migration history stays intact.
do $$ declare f record; definition text; begin
  grant create on schema public, change_control to space_runtime;
  for f in select p.oid,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','change_control') and p.prokind='f'
      and p.proname not in ('current_space_id','space_read_allowed','sync_profile','set_profile_name','metadata_name')
      and not exists(select 1 from pg_depend d where d.objid=p.oid and d.classid='pg_proc'::regclass and d.deptype='e') loop
    definition := pg_get_functiondef(f.oid);
    definition := regexp_replace(definition,'on conflict\s*\(', 'on conflict (space_id, ', 'gi');
    execute definition;
    execute format('alter function %s owner to space_runtime',f.signature);
  end loop;
  revoke create on schema public, change_control from space_runtime;
end $$;
grant select on public.profiles,public.entity_types to space_runtime;
do $$ declare v record; begin
  for v in select relname from pg_class where relnamespace='public'::regnamespace and relkind='v' loop
    execute format('grant select on public.%I to space_runtime',v.relname);
  end loop;
end $$;
grant execute on all functions in schema public,change_control to space_runtime;
-- Shared vocabulary is read-only to the runtime.
create policy entity_types_server on public.entity_types for select to space_runtime using (true);
create policy profiles_server on public.profiles for select to space_runtime using (true);

create function public.create_space(p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person uuid; s public.spaces; h jsonb; begin
  h := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  person := auth.uid();
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role'='service_role' then person := nullif(h->>'x-person-id','')::uuid; end if;
  if person is null then raise exception 'Not signed in' using errcode='42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'Use a space name between 1 and 80 characters'; end if;
  insert into public.spaces(owner_id,name) values(person,btrim(p_name)) returning * into s;
  -- Empty default groups support the existing root-domain placement rules.
  insert into public.domain_tabs(id,name,description,space_id) values
    ('00000000-0000-4000-8000-000000000001','Organizations','Organizations and their policies and practices.',s.id),
    ('00000000-0000-4000-8000-000000000002','External references','General reference topics and external guidance.',s.id);
  return to_jsonb(s);
end $$;
revoke all on function public.create_space(text) from public,anon,authenticated;
grant execute on function public.create_space(text) to service_role,space_runtime;

create function public.ensure_my_space() returns jsonb
language plpgsql security definer set search_path='' as $$
declare person uuid; s public.spaces; h jsonb; begin
  h := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  person := auth.uid();
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role'='service_role' then person := nullif(h->>'x-person-id','')::uuid; end if;
  if person is null then raise exception 'Not signed in' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(person::text,0));
  select * into s from public.spaces where owner_id=person order by created_at,id limit 1;
  if s.id is null then
    update public.spaces set owner_id=person where id='00000000-0000-4000-8000-000000000001' and owner_id is null returning * into s;
    if s.id is null then return public.create_space('My Space'); end if;
  end if;
  return to_jsonb(s);
end $$;
revoke all on function public.ensure_my_space() from public,anon,authenticated;
grant execute on function public.ensure_my_space() to service_role,space_runtime;
grant select on public.spaces to space_runtime;
create policy spaces_server on public.spaces for select to space_runtime using (owner_id = nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-person-id','')::uuid);

-- Only server workers may enumerate spaces; each job then runs under the same
-- RLS boundary as a person's request.
create function public.worker_spaces() returns setof uuid
language sql stable security definer set search_path='' as $$ select id from public.spaces order by created_at,id $$;
revoke all on function public.worker_spaces() from public,anon,authenticated;
grant execute on function public.worker_spaces() to service_role,space_runtime;

-- PostgREST invokes this as the request role before running a query. Only
-- trusted server requests switch role; browser users keep read-only grants.
create function public.scope_space_request() returns void language plpgsql set search_path='' as $$
begin
  if current_user='service_role' then execute 'set local role space_runtime'; end if;
end $$;
grant execute on function public.scope_space_request() to anon,authenticated,service_role,space_runtime;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticator') then
    grant space_runtime to authenticator;
    alter role authenticator set pgrst.db_pre_request='public.scope_space_request';
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
