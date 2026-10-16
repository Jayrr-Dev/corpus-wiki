-- =====================================================================
-- SECOND BRAIN · AI ROLE MEMORY
-- =====================================================================
-- A key → value notebook per AI role (lib/ai/roles.ts MODEL_ROLES): what a
-- role chose to keep for its future runs (caches, quick context, working
-- notes). The model writes it through optional memory tools offered on
-- its calls (lib/ai/memory.ts); people read and clear it on
-- /skills → Roles. Run-only notes never reach this table: they live in the
-- server's memory for the run.
--
-- Lookups are by (role, key), the B-tree primary key; the top-N read per
-- role uses the (role, updated_at) B-tree. No other index types (OrioleDB).
-- Memory is the role's own notes, never evidence: no claim cites it.
-- =====================================================================

create table public.ai_role_memory (
  role text not null check (role in ('media_analyst','reconciler','deduplicator','identify_entities','link_knowledge','dictionary_editor','define_concepts','plan_articles','article_reviewer','write_articles','reviewer','researcher','domain_steward')),
  key text not null check (length(btrim(key)) between 1 and 120),
  value text not null check (length(value) between 1 and 1000),
  -- The call purpose that wrote it (e.g. section_lines), so a person sees where a note came from
  source text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (role, key)
);
create index ai_role_memory_recent on public.ai_role_memory (role, updated_at desc);

alter table public.ai_role_memory enable row level security;
revoke all on public.ai_role_memory from anon, authenticated;

-- READ: one role's live entries, newest first: [{ key, value, source, updatedAt, expiresAt }]
create function public.get_role_memory(p_role text, p_limit integer default 200)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', m.key, 'value', m.value, 'source', m.source, 'updatedAt', m.updated_at, 'expiresAt', m.expires_at) order by m.updated_at desc), '[]'::jsonb)
  from (
    select * from public.ai_role_memory m
    where m.role = p_role and (m.expires_at is null or m.expires_at > now())
    order by m.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 200))
  ) m;
$$;

-- READ ALL: { "<role>": [entries] } for the Roles tab
create function public.get_all_role_memory()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(r.role, public.get_role_memory(r.role, 200)), '{}'::jsonb)
  from (select distinct m.role from public.ai_role_memory m where m.expires_at is null or m.expires_at > now()) r;
$$;

-- WRITE: upserts entries [{ key, value, ttlHours }], deletes the `p_forget` keys and expired
-- entries, then keeps the role's newest 200. Returns the number of live entries.
create function public.remember_role_memory(p_role text, p_entries jsonb, p_forget text[], p_source text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_ttl numeric;
  v_count integer;
begin
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array' then raise exception 'p_entries must be an array'; end if;
  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    continue when length(btrim(coalesce(v_entry ->> 'key', ''))) = 0 or length(coalesce(v_entry ->> 'value', '')) = 0;
    v_ttl := case when jsonb_typeof(v_entry -> 'ttlHours') = 'number' then (v_entry ->> 'ttlHours')::numeric end;
    insert into public.ai_role_memory (role, key, value, source, expires_at)
    values (p_role, left(btrim(v_entry ->> 'key'), 120), left(v_entry ->> 'value', 1000), p_source,
            case when v_ttl > 0 then now() + make_interval(secs => least(v_ttl, 24 * 365) * 3600) end)
    on conflict (role, key) do update set
      value = excluded.value, source = excluded.source, expires_at = excluded.expires_at, updated_at = now();
  end loop;
  delete from public.ai_role_memory m where m.role = p_role and (m.key = any(coalesce(p_forget, '{}')) or m.expires_at <= now());
  delete from public.ai_role_memory m where m.role = p_role and m.key in (
    select o.key from public.ai_role_memory o where o.role = p_role order by o.updated_at desc offset 200
  );
  select count(*) into v_count from public.ai_role_memory m where m.role = p_role;
  return v_count;
end;
$$;

-- CLEAR: one entry, or the role's whole memory when p_key is null
create function public.clear_role_memory(p_role text, p_key text)
returns void
language sql
set search_path = ''
as $$
  delete from public.ai_role_memory m where m.role = p_role and (p_key is null or m.key = p_key);
$$;

revoke execute on function public.get_role_memory(text, integer) from public, anon, authenticated;
revoke execute on function public.get_all_role_memory() from public, anon, authenticated;
revoke execute on function public.remember_role_memory(text, jsonb, text[], text) from public, anon, authenticated;
revoke execute on function public.clear_role_memory(text, text) from public, anon, authenticated;
grant execute on function public.get_role_memory(text, integer) to service_role;
grant execute on function public.get_all_role_memory() to service_role;
grant execute on function public.remember_role_memory(text, jsonb, text[], text) to service_role;
grant execute on function public.clear_role_memory(text, text) to service_role;
