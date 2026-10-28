-- =====================================================================
-- AGENT KEYS: bearer keys outside agents use for the MCP server (/api/mcp)
-- =====================================================================
-- 1. TABLES. public.agent_keys holds each key's owner, Space (null = any
--    Space its owner owns), scopes (lib/agents/scopes.ts) and the sha256
--    hash of the key. The plain key is shown once and never stored.
--    public.agent_calls is the audit log: one line per tool call.
-- 2. ACCESS. The signed-in owner reads their own keys (every column but
--    key_hash) and their keys' calls. Nobody writes the tables directly:
--    keys change only through the functions below.
-- 3. FUNCTIONS. create_agent_key and revoke_agent_key act for the person
--    the server names (x-person-id), as rename_space does.
--    resolve_agent_key, agent_call_counts and record_agent_call are for the
--    server only. Service requests run as space_runtime, which has no grant
--    on these tables, so the functions are SECURITY DEFINER and keep the
--    migration role as owner (a table's owner is not held by its RLS).
-- =====================================================================


-- =====================================================================
-- 1. TABLES
-- =====================================================================

create table public.agent_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid references public.spaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix text not null check (length(key_prefix) = 8),
  scopes text[] not null check (
    cardinality(scopes) > 0
    and scopes <@ array['read', 'write', 'delete', 'spaces', 'settings']::text[]),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  -- Creating and renaming Spaces needs a key that is not tied to one Space
  check (space_id is null or not ('spaces' = any (scopes)))
);
comment on table public.agent_keys is 'Bearer keys (cwk_...) for the MCP server; only the sha256 hash is stored.';
create index agent_keys_owner_idx on public.agent_keys (owner_id, created_at);

create table public.agent_calls (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.agent_keys (id) on delete cascade,
  space_id uuid references public.spaces (id) on delete cascade,
  tool text not null,
  scope text not null check (scope in ('read', 'write', 'delete', 'spaces', 'settings')),
  ok boolean not null,
  error text,
  ms integer not null default 0,
  summary text not null default '',
  created_at timestamptz not null default now()
);
comment on table public.agent_calls is 'Audit log: one line per MCP tool call, written by record_agent_call.';
create index agent_calls_key_time_idx on public.agent_calls (key_id, created_at);


-- =====================================================================
-- 2. ACCESS
-- =====================================================================

alter table public.agent_keys enable row level security;
alter table public.agent_calls enable row level security;

create policy agent_keys_owner_read on public.agent_keys for select to authenticated
  using (owner_id = (select auth.uid()));
create policy agent_calls_owner_read on public.agent_calls for select to authenticated
  using (exists (select 1 from public.agent_keys k where k.id = key_id and k.owner_id = (select auth.uid())));

revoke all on public.agent_keys, public.agent_calls from public, anon, authenticated;
-- Every column but key_hash
grant select (id, owner_id, space_id, name, key_prefix, scopes, expires_at, revoked_at, last_used_at, created_at)
  on public.agent_keys to authenticated;
grant select on public.agent_calls to authenticated;


-- =====================================================================
-- 3. FUNCTIONS
-- =====================================================================

-- A new key for the person the server names. Returns the plain key once.
create function public.create_agent_key(p_name text, p_space uuid, p_scopes text[], p_expires_at timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  person uuid := public.space_management_person();
  scopes text[];
  token text;
  k public.agent_keys;
begin
  -- Only a person in Settings makes or widens a key, never an agent
  if coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb->>'x-via' = 'agent' then
    raise exception 'Agents cannot manage agent keys' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Use a key name between 1 and 80 characters';
  end if;
  select coalesce(array_agg(distinct s order by s), '{}') into scopes from unnest(p_scopes) s;
  if cardinality(scopes) = 0 then raise exception 'Choose at least one scope'; end if;
  if not scopes <@ array['read', 'write', 'delete', 'spaces', 'settings']::text[] then
    raise exception 'Unknown scope';
  end if;
  if p_space is not null and 'spaces' = any (scopes) then
    raise exception 'The spaces scope needs a key for all Spaces';
  end if;
  if p_space is not null and not exists (
    select 1 from public.spaces where id = p_space and owner_id = person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode = '42501';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Choose an expiry date in the future';
  end if;
  token := 'cwk_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/\n', '-_'), '=');
  insert into public.agent_keys (owner_id, space_id, name, key_hash, key_prefix, scopes, expires_at)
  values (person, p_space, btrim(p_name), encode(sha256(convert_to(token, 'UTF8')), 'hex'), substr(token, 5, 8), scopes, p_expires_at)
  returning * into k;
  return jsonb_build_object(
    'id', k.id, 'name', k.name, 'space_id', k.space_id, 'key_prefix', k.key_prefix,
    'scopes', to_jsonb(k.scopes), 'expires_at', k.expires_at, 'created_at', k.created_at, 'key', token);
end $$;

-- Revokes one of the named person's keys; revoking twice is a no-op
create function public.revoke_agent_key(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare person uuid := public.space_management_person();
begin
  if coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb->>'x-via' = 'agent' then
    raise exception 'Agents cannot manage agent keys' using errcode = '42501';
  end if;
  if not exists (select 1 from public.agent_keys where id = p_id and owner_id = person) then
    raise exception 'Key not found' using errcode = '42501';
  end if;
  update public.agent_keys set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

-- True when the request comes from the server (secret key), not a browser
create function public.agent_keys_server_request() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' = 'service_role'
$$;

-- The live key with this hash (not revoked, not expired, its owner still
-- owns its Space), or null. Marks the key as used.
create function public.resolve_agent_key(p_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare k public.agent_keys;
begin
  if not public.agent_keys_server_request() then raise exception 'Server only' using errcode = '42501'; end if;
  select a.* into k from public.agent_keys a
  where a.key_hash = p_hash
    and a.revoked_at is null
    and (a.expires_at is null or a.expires_at > now())
    and (a.space_id is null or exists (
      select 1 from public.spaces s where s.id = a.space_id and s.owner_id = a.owner_id and s.deleted_at is null));
  if k.id is null then return null; end if;
  update public.agent_keys set last_used_at = now() where id = k.id;
  return jsonb_build_object('id', k.id, 'name', k.name, 'owner_id', k.owner_id, 'space_id', k.space_id, 'scopes', to_jsonb(k.scopes));
end $$;

-- How many calls this key made in the last minute, and non-read calls in the last day
create function public.agent_call_counts(p_key uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.agent_keys_server_request() then raise exception 'Server only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'minute', (select count(*) from public.agent_calls where key_id = p_key and created_at > now() - interval '1 minute'),
    'day_changes', (select count(*) from public.agent_calls where key_id = p_key and created_at > now() - interval '1 day' and scope <> 'read'));
end $$;

-- Writes one audit line
create function public.record_agent_call(p_key uuid, p_space uuid, p_tool text, p_scope text, p_ok boolean, p_error text, p_ms integer, p_summary text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.agent_keys_server_request() then raise exception 'Server only' using errcode = '42501'; end if;
  insert into public.agent_calls (key_id, space_id, tool, scope, ok, error, ms, summary)
  values (p_key, p_space, left(p_tool, 120), p_scope, p_ok, left(p_error, 2000), greatest(coalesce(p_ms, 0), 0), left(coalesce(p_summary, ''), 500));
end $$;

revoke all on function
  public.create_agent_key(text, uuid, text[], timestamptz), public.revoke_agent_key(uuid),
  public.agent_keys_server_request(), public.resolve_agent_key(text), public.agent_call_counts(uuid),
  public.record_agent_call(uuid, uuid, text, text, boolean, text, integer, text)
  from public, anon, authenticated;
-- Service requests switch to space_runtime before they run (scope_space_request)
grant execute on function
  public.create_agent_key(text, uuid, text[], timestamptz), public.revoke_agent_key(uuid),
  public.agent_keys_server_request(), public.resolve_agent_key(text), public.agent_call_counts(uuid),
  public.record_agent_call(uuid, uuid, text, text, boolean, text, integer, text)
  to service_role, space_runtime;

notify pgrst, 'reload schema';
