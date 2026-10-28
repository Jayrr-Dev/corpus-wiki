-- =====================================================================
-- AGENT AUTH: how outside agents sign in to the MCP server (/api/mcp)
-- =====================================================================
-- Two kinds of credential (docs/mcp-server-plan.md):
-- - OAuth 2.1 (the MCP authorization standard). A client (registered by
--   Dynamic Client Registration, or known by its Client ID Metadata
--   Document URL) asks; the person consents to a Space and scopes, which
--   makes a grant; a one-time code becomes an access token (1 hour) and a
--   refresh token that rotates on every use. A reused refresh token
--   revokes its whole family.
-- - Personal keys (cwk_...), made in Settings, for scripts and static
--   request headers. They carry their scopes directly.
-- Only sha256 hashes of codes, tokens and keys are stored.
--
-- 1. TABLES: agent_keys, oauth_clients, oauth_grants, oauth_codes,
--    oauth_tokens, agent_calls (the audit log). B-tree indexes only.
-- 2. ACCESS: the signed-in person reads their own keys (never key_hash),
--    grants, the clients they granted, and their calls. Nobody writes
--    the tables directly; codes and tokens are never readable.
-- 3. PERSON FUNCTIONS act for the person the server names (x-person-id),
--    as rename_space does, and refuse agent requests.
-- 4. SERVER FUNCTIONS are for the server's secret key only. Service
--    requests run as space_runtime, which has no grant on these tables,
--    so every function is SECURITY DEFINER and keeps the migration role
--    as owner (a table's owner is not held by its RLS).
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
  -- Creating and renaming Spaces needs a credential that is not tied to one Space
  check (space_id is null or not ('spaces' = any (scopes)))
);
comment on table public.agent_keys is 'Personal keys (cwk_...) for the MCP server; only the sha256 hash is stored.';
create index agent_keys_owner_idx on public.agent_keys (owner_id, created_at);

-- client_id is an HTTPS URL (a Client ID Metadata Document, refetched when
-- stale) or a random id from Dynamic Client Registration. Public clients only.
create table public.oauth_clients (
  client_id text primary key check (length(client_id) between 1 and 2000),
  name text not null check (length(btrim(name)) between 1 and 200),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 20),
  kind text not null check (kind in ('cimd', 'dcr')),
  metadata jsonb not null default '{}',
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.oauth_clients is 'OAuth clients of the MCP server: Client ID Metadata Documents (cimd) and dynamically registered clients (dcr).';

-- What a person allowed a client: one Space (or all) and the scopes. One
-- live grant per person and client; consenting again updates it.
create table public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  space_id uuid references public.spaces (id) on delete cascade,
  scopes text[] not null check (
    cardinality(scopes) > 0
    and scopes <@ array['read', 'write', 'delete', 'spaces', 'settings']::text[]),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  check (space_id is null or not ('spaces' = any (scopes)))
);
comment on table public.oauth_grants is 'A person''s consent for one OAuth client: a Space (null = all) and scopes.';
create unique index oauth_grants_live_idx on public.oauth_grants (person_id, client_id) where revoked_at is null;
create index oauth_grants_client_idx on public.oauth_grants (client_id);

-- Authorization codes: 10 minutes, once. family_id names the tokens the
-- code was exchanged for, so a replayed code can revoke them.
create table public.oauth_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  grant_id uuid not null references public.oauth_grants (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  resource text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  family_id uuid,
  created_at timestamptz not null default now()
);
create index oauth_codes_grant_idx on public.oauth_codes (grant_id);

-- Access and refresh tokens. A family is one code's chain of refreshes;
-- replaced_by is the hash of the refresh token that replaced this one.
create table public.oauth_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('access', 'refresh')),
  grant_id uuid not null references public.oauth_grants (id) on delete cascade,
  family_id uuid not null,
  resource text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by text,
  created_at timestamptz not null default now()
);
create index oauth_tokens_grant_idx on public.oauth_tokens (grant_id);
create index oauth_tokens_family_idx on public.oauth_tokens (family_id);

-- The audit log: one line per MCP tool call, by a personal key or an OAuth
-- grant. space_id is what the call asked for, so it has no foreign key.
create table public.agent_calls (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references auth.users (id) on delete cascade,
  key_id uuid references public.agent_keys (id) on delete cascade,
  grant_id uuid references public.oauth_grants (id) on delete cascade,
  space_id uuid,
  tool text not null,
  scope text not null check (scope in ('read', 'write', 'delete', 'spaces', 'settings')),
  ok boolean not null,
  error text,
  ms integer not null default 0,
  summary text not null default '',
  created_at timestamptz not null default now(),
  check (num_nonnulls(key_id, grant_id) = 1)
);
comment on table public.agent_calls is 'Audit log: one line per MCP tool call, written by record_agent_call.';
create index agent_calls_key_time_idx on public.agent_calls (key_id, created_at);
create index agent_calls_grant_time_idx on public.agent_calls (grant_id, created_at);


-- =====================================================================
-- 2. ACCESS
-- =====================================================================

alter table public.agent_keys enable row level security;
alter table public.oauth_clients enable row level security;
alter table public.oauth_grants enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.agent_calls enable row level security;

create policy agent_keys_owner_read on public.agent_keys for select to authenticated
  using (owner_id = (select auth.uid()));
create policy oauth_grants_owner_read on public.oauth_grants for select to authenticated
  using (person_id = (select auth.uid()));
create policy oauth_clients_granted_read on public.oauth_clients for select to authenticated
  using (exists (select 1 from public.oauth_grants g where g.client_id = oauth_clients.client_id and g.person_id = (select auth.uid())));
create policy agent_calls_owner_read on public.agent_calls for select to authenticated
  using (person_id = (select auth.uid()));

revoke all on public.agent_keys, public.oauth_clients, public.oauth_grants, public.oauth_codes, public.oauth_tokens, public.agent_calls
  from public, anon, authenticated;
-- Every column but key_hash
grant select (id, owner_id, space_id, name, key_prefix, scopes, expires_at, revoked_at, last_used_at, created_at)
  on public.agent_keys to authenticated;
grant select (client_id, name, redirect_uris, kind, created_at) on public.oauth_clients to authenticated;
grant select on public.oauth_grants, public.agent_calls to authenticated;


-- =====================================================================
-- 3. PERSON FUNCTIONS
-- =====================================================================

-- Raises unless the request comes from a person (not an agent acting as one)
create function public.agent_auth_require_person() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  -- Only a person in Settings or on the consent screen grants or widens access
  if coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb->>'x-via' = 'agent' then
    raise exception 'Agents cannot manage agent access' using errcode = '42501';
  end if;
  return public.space_management_person();
end $$;

-- The scopes, deduplicated and checked against a Space choice
create function public.agent_auth_scopes(p_scopes text[], p_space uuid) returns text[]
language plpgsql immutable set search_path = '' as $$
declare scopes text[];
begin
  select coalesce(array_agg(distinct s order by s), '{}') into scopes from unnest(p_scopes) s;
  if cardinality(scopes) = 0 then raise exception 'Choose at least one scope'; end if;
  if not scopes <@ array['read', 'write', 'delete', 'spaces', 'settings']::text[] then
    raise exception 'Unknown scope';
  end if;
  if p_space is not null and 'spaces' = any (scopes) then
    raise exception 'The spaces scope needs access to all Spaces';
  end if;
  return scopes;
end $$;

-- Raises unless the person owns this live Space (null means all Spaces)
create function public.agent_auth_check_space(p_person uuid, p_space uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_space is not null and not exists (
    select 1 from public.spaces where id = p_space and owner_id = p_person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode = '42501';
  end if;
end $$;

-- A new personal key for the person the server names. Returns the plain key once.
create function public.create_agent_key(p_name text, p_space uuid, p_scopes text[], p_expires_at timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  person uuid := public.agent_auth_require_person();
  v_scopes text[] := public.agent_auth_scopes(p_scopes, p_space);
  token text;
  k public.agent_keys;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Use a key name between 1 and 80 characters';
  end if;
  perform public.agent_auth_check_space(person, p_space);
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Choose an expiry date in the future';
  end if;
  token := 'cwk_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/\n', '-_'), '=');
  insert into public.agent_keys (owner_id, space_id, name, key_hash, key_prefix, scopes, expires_at)
  values (person, p_space, btrim(p_name), encode(sha256(convert_to(token, 'UTF8')), 'hex'), substr(token, 5, 8), v_scopes, p_expires_at)
  returning * into k;
  return jsonb_build_object(
    'id', k.id, 'name', k.name, 'space_id', k.space_id, 'key_prefix', k.key_prefix,
    'scopes', to_jsonb(k.scopes), 'expires_at', k.expires_at, 'created_at', k.created_at, 'key', token);
end $$;

-- Revokes one of the person's keys; revoking twice is a no-op
create function public.revoke_agent_key(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare person uuid := public.agent_auth_require_person();
begin
  if not exists (select 1 from public.agent_keys where id = p_id and owner_id = person) then
    raise exception 'Key not found' using errcode = '42501';
  end if;
  update public.agent_keys set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

-- CONSENT: the person allows a client a Space and scopes, and gets a
-- one-time code for it. The server has already checked the client, its
-- redirect URI, the PKCE challenge and the resource; it passes the code's hash.
create function public.oauth_authorize(
  p_client_id text, p_space uuid, p_scopes text[], p_code_hash text,
  p_redirect_uri text, p_code_challenge text, p_resource text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  person uuid := public.agent_auth_require_person();
  v_scopes text[] := public.agent_auth_scopes(p_scopes, p_space);
  v_grant uuid;
begin
  perform public.agent_auth_check_space(person, p_space);
  if not exists (select 1 from public.oauth_clients where client_id = p_client_id) then
    raise exception 'Unknown client';
  end if;
  -- One live grant per person and client: consenting again replaces its Space and scopes
  perform pg_advisory_xact_lock(hashtextextended(person::text || p_client_id, 0));
  update public.oauth_grants set space_id = p_space, scopes = v_scopes
  where person_id = person and client_id = p_client_id and revoked_at is null
  returning id into v_grant;
  if v_grant is null then
    insert into public.oauth_grants (person_id, client_id, space_id, scopes)
    values (person, p_client_id, p_space, v_scopes) returning id into v_grant;
  end if;
  insert into public.oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, resource, scopes, expires_at)
  values (p_code_hash, v_grant, p_redirect_uri, p_code_challenge, p_resource, v_scopes, now() + interval '10 minutes');
  return v_grant;
end $$;

-- Revokes one of the person's grants and every token it issued
create function public.revoke_oauth_grant(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare person uuid := public.agent_auth_require_person();
begin
  if not exists (select 1 from public.oauth_grants where id = p_id and person_id = person) then
    raise exception 'Connection not found' using errcode = '42501';
  end if;
  update public.oauth_grants set revoked_at = now() where id = p_id and revoked_at is null;
  update public.oauth_tokens set revoked_at = now() where grant_id = p_id and revoked_at is null;
end $$;


-- =====================================================================
-- 4. SERVER FUNCTIONS
-- =====================================================================

-- True when the request comes from the server (secret key), not a browser
create function public.agent_auth_server_request() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' = 'service_role'
$$;

create function public.agent_auth_require_server() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not public.agent_auth_server_request() then raise exception 'Server only' using errcode = '42501'; end if;
end $$;

-- An OAuth client by id, or null
create function public.oauth_get_client(p_client_id text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.oauth_clients;
begin
  perform public.agent_auth_require_server();
  select * into c from public.oauth_clients where client_id = p_client_id;
  if c.client_id is null then return null; end if;
  return to_jsonb(c);
end $$;

-- Saves a client: a new registration (dcr, never overwritten) or a freshly
-- fetched metadata document (cimd, replaced on every fetch)
create function public.oauth_save_client(p_client_id text, p_name text, p_redirect_uris text[], p_kind text, p_metadata jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.oauth_clients;
begin
  perform public.agent_auth_require_server();
  if exists (select 1 from unnest(p_redirect_uris) u where length(u) > 2000) then
    raise exception 'Redirect URI too long';
  end if;
  if p_kind = 'dcr' then
    insert into public.oauth_clients (client_id, name, redirect_uris, kind, metadata)
    values (p_client_id, btrim(p_name), p_redirect_uris, 'dcr', coalesce(p_metadata, '{}'))
    returning * into c;
  else
    insert into public.oauth_clients (client_id, name, redirect_uris, kind, metadata, fetched_at)
    values (p_client_id, btrim(p_name), p_redirect_uris, 'cimd', coalesce(p_metadata, '{}'), now())
    on conflict (client_id) do update set name = excluded.name, redirect_uris = excluded.redirect_uris,
      metadata = excluded.metadata, fetched_at = excluded.fetched_at
      where public.oauth_clients.kind = 'cimd'
    returning * into c;
    if c.client_id is null then raise exception 'Client id already registered'; end if;
  end if;
  return to_jsonb(c);
end $$;

-- Revokes every live token in one family (a reused code or refresh token)
create function public.oauth_revoke_family(p_family uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.oauth_tokens set revoked_at = now() where family_id = p_family and revoked_at is null
$$;

-- Saves a new access and refresh token pair in a family
create function public.oauth_issue_tokens(
  p_grant uuid, p_family uuid, p_resource text, p_scopes text[],
  p_access_hash text, p_refresh_hash text, p_access_seconds integer, p_refresh_seconds integer)
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.oauth_tokens (token_hash, kind, grant_id, family_id, resource, scopes, expires_at) values
    (p_access_hash, 'access', p_grant, p_family, p_resource, p_scopes, now() + make_interval(secs => p_access_seconds)),
    (p_refresh_hash, 'refresh', p_grant, p_family, p_resource, p_scopes, now() + make_interval(secs => p_refresh_seconds))
$$;

-- AUTHORIZATION CODE GRANT. The server passes the code's hash and the
-- S256 of the code_verifier. Any attempt on a live code uses it up; a
-- second use revokes the tokens the first one issued. Answers
-- { error, error_description } (RFC 6749 codes) or { scopes, resource }.
-- Errors are returned, not raised, so the revocations they make are kept.
create function public.oauth_exchange_code(
  p_code_hash text, p_client_id text, p_redirect_uri text, p_challenge text, p_resource text,
  p_access_hash text, p_refresh_hash text, p_access_seconds integer, p_refresh_seconds integer)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.oauth_codes;
  g public.oauth_grants;
  family uuid := gen_random_uuid();
begin
  perform public.agent_auth_require_server();
  select * into c from public.oauth_codes where code_hash = p_code_hash for update;
  if c.code_hash is null then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Unknown authorization code');
  end if;
  if c.used_at is not null then
    if c.family_id is not null then perform public.oauth_revoke_family(c.family_id); end if;
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Authorization code already used');
  end if;
  update public.oauth_codes set used_at = now() where code_hash = p_code_hash;
  select * into g from public.oauth_grants where id = c.grant_id;
  if c.expires_at <= now() then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Authorization code expired');
  end if;
  if g.client_id <> p_client_id then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Code was issued to another client');
  end if;
  if c.redirect_uri <> p_redirect_uri then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'redirect_uri does not match');
  end if;
  if c.code_challenge <> p_challenge then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'PKCE code_verifier does not match');
  end if;
  if p_resource is not null and p_resource <> c.resource then
    return jsonb_build_object('error', 'invalid_target', 'error_description', 'resource does not match the authorization request');
  end if;
  if g.revoked_at is not null then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Access was revoked');
  end if;
  update public.oauth_codes set family_id = family where code_hash = p_code_hash;
  perform public.oauth_issue_tokens(g.id, family, c.resource, c.scopes, p_access_hash, p_refresh_hash, p_access_seconds, p_refresh_seconds);
  return jsonb_build_object('scopes', to_jsonb(c.scopes), 'resource', c.resource);
end $$;

-- REFRESH TOKEN GRANT with rotation. A refresh token works once; using a
-- replaced or revoked one revokes its whole family. p_scopes (optional)
-- may only narrow. Answers like oauth_exchange_code.
create function public.oauth_refresh(
  p_refresh_hash text, p_client_id text, p_resource text, p_scopes text[],
  p_access_hash text, p_new_refresh_hash text, p_access_seconds integer, p_refresh_seconds integer)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.oauth_tokens;
  g public.oauth_grants;
  scopes text[];
begin
  perform public.agent_auth_require_server();
  select * into t from public.oauth_tokens where token_hash = p_refresh_hash and kind = 'refresh' for update;
  if t.token_hash is null then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Unknown refresh token');
  end if;
  select * into g from public.oauth_grants where id = t.grant_id;
  if g.client_id <> p_client_id then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Refresh token was issued to another client');
  end if;
  if t.revoked_at is not null or t.replaced_by is not null then
    perform public.oauth_revoke_family(t.family_id);
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Refresh token already used or revoked');
  end if;
  if t.expires_at <= now() then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Refresh token expired');
  end if;
  if g.revoked_at is not null then
    return jsonb_build_object('error', 'invalid_grant', 'error_description', 'Access was revoked');
  end if;
  if p_resource is not null and p_resource <> t.resource then
    return jsonb_build_object('error', 'invalid_target', 'error_description', 'resource does not match the original grant');
  end if;
  -- Never wider than the token and the grant as it stands now
  select coalesce(array_agg(s order by s), '{}') into scopes from unnest(t.scopes) s where s = any (g.scopes);
  if p_scopes is not null then
    if not p_scopes <@ scopes then
      return jsonb_build_object('error', 'invalid_scope', 'error_description', 'Requested scope exceeds what was granted');
    end if;
    select coalesce(array_agg(distinct s order by s), '{}') into scopes from unnest(p_scopes) s;
  end if;
  if cardinality(scopes) = 0 then
    return jsonb_build_object('error', 'invalid_scope', 'error_description', 'No granted scope is left');
  end if;
  update public.oauth_tokens set revoked_at = now(), replaced_by = p_new_refresh_hash where token_hash = p_refresh_hash;
  perform public.oauth_issue_tokens(g.id, t.family_id, t.resource, scopes, p_access_hash, p_new_refresh_hash, p_access_seconds, p_refresh_seconds);
  return jsonb_build_object('scopes', to_jsonb(scopes), 'resource', t.resource);
end $$;

-- TOKEN REVOCATION (RFC 7009): revokes an access token, or a refresh token
-- and its family. Unknown tokens and other clients' tokens are ignored.
create function public.oauth_revoke_token(p_token_hash text, p_client_id text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare t public.oauth_tokens;
begin
  perform public.agent_auth_require_server();
  select tk.* into t from public.oauth_tokens tk join public.oauth_grants g on g.id = tk.grant_id
  where tk.token_hash = p_token_hash and (p_client_id is null or g.client_id = p_client_id);
  if t.token_hash is null then return; end if;
  if t.kind = 'refresh' then perform public.oauth_revoke_family(t.family_id);
  else update public.oauth_tokens set revoked_at = now() where token_hash = p_token_hash and revoked_at is null;
  end if;
end $$;

-- The live personal key with this hash (not revoked, not expired, its owner
-- still owns its Space), or null. Marks the key as used.
create function public.resolve_agent_key(p_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare k public.agent_keys;
begin
  perform public.agent_auth_require_server();
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

-- The live OAuth access token with this hash, issued for p_resource (RFC
-- 8707 audience), whose grant is live and whose Space its person still
-- owns; or null. Scopes are the token's, narrowed by the grant as it is now.
create function public.resolve_oauth_token(p_hash text, p_resource text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t public.oauth_tokens;
  g public.oauth_grants;
  client_name text;
  scopes text[];
begin
  perform public.agent_auth_require_server();
  select * into t from public.oauth_tokens
  where token_hash = p_hash and kind = 'access' and revoked_at is null and expires_at > now() and resource = p_resource;
  if t.token_hash is null then return null; end if;
  select * into g from public.oauth_grants where id = t.grant_id and revoked_at is null;
  if g.id is null then return null; end if;
  if g.space_id is not null and not exists (
    select 1 from public.spaces s where s.id = g.space_id and s.owner_id = g.person_id and s.deleted_at is null) then
    return null;
  end if;
  select coalesce(array_agg(s order by s), '{}') into scopes from unnest(t.scopes) s where s = any (g.scopes);
  if cardinality(scopes) = 0 then return null; end if;
  -- One write a minute at most per grant
  if g.last_used_at is null or g.last_used_at < now() - interval '1 minute' then
    update public.oauth_grants set last_used_at = now() where id = g.id;
  end if;
  select name into client_name from public.oauth_clients where client_id = g.client_id;
  return jsonb_build_object('id', g.id, 'client_id', g.client_id, 'name', client_name,
    'owner_id', g.person_id, 'space_id', g.space_id, 'scopes', to_jsonb(scopes));
end $$;

-- How many calls this credential (key or grant id) made in the last
-- minute, and non-read calls in the last day
create function public.agent_call_counts(p_key uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.agent_auth_require_server();
  return jsonb_build_object(
    'minute',
      (select count(*) from public.agent_calls where key_id = p_key and created_at > now() - interval '1 minute')
      + (select count(*) from public.agent_calls where grant_id = p_key and created_at > now() - interval '1 minute'),
    'day_changes',
      (select count(*) from public.agent_calls where key_id = p_key and created_at > now() - interval '1 day' and scope <> 'read')
      + (select count(*) from public.agent_calls where grant_id = p_key and created_at > now() - interval '1 day' and scope <> 'read'));
end $$;

-- Writes one audit line for a key or grant id; an unknown id writes nothing
create function public.record_agent_call(p_key uuid, p_space uuid, p_tool text, p_scope text, p_ok boolean, p_error text, p_ms integer, p_summary text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare person uuid; is_key boolean := true;
begin
  perform public.agent_auth_require_server();
  select owner_id into person from public.agent_keys where id = p_key;
  if person is null then
    select person_id into person from public.oauth_grants where id = p_key;
    is_key := false;
  end if;
  if person is null then return; end if;
  insert into public.agent_calls (person_id, key_id, grant_id, space_id, tool, scope, ok, error, ms, summary)
  values (person, case when is_key then p_key end, case when is_key then null else p_key end, p_space,
    left(p_tool, 120), p_scope, p_ok, left(p_error, 2000), greatest(coalesce(p_ms, 0), 0), left(coalesce(p_summary, ''), 500));
end $$;

revoke all on function
  public.agent_auth_require_person(), public.agent_auth_scopes(text[], uuid), public.agent_auth_check_space(uuid, uuid),
  public.create_agent_key(text, uuid, text[], timestamptz), public.revoke_agent_key(uuid),
  public.oauth_authorize(text, uuid, text[], text, text, text, text), public.revoke_oauth_grant(uuid),
  public.agent_auth_server_request(), public.agent_auth_require_server(),
  public.oauth_get_client(text), public.oauth_save_client(text, text, text[], text, jsonb),
  public.oauth_revoke_family(uuid), public.oauth_issue_tokens(uuid, uuid, text, text[], text, text, integer, integer),
  public.oauth_exchange_code(text, text, text, text, text, text, text, integer, integer),
  public.oauth_refresh(text, text, text, text[], text, text, integer, integer),
  public.oauth_revoke_token(text, text),
  public.resolve_agent_key(text), public.resolve_oauth_token(text, text),
  public.agent_call_counts(uuid), public.record_agent_call(uuid, uuid, text, text, boolean, text, integer, text)
  from public, anon, authenticated;
-- Service requests switch to space_runtime before they run (scope_space_request).
-- The helpers that write tokens directly are callable only from the functions above.
grant execute on function
  public.agent_auth_require_person(), public.agent_auth_scopes(text[], uuid), public.agent_auth_check_space(uuid, uuid),
  public.create_agent_key(text, uuid, text[], timestamptz), public.revoke_agent_key(uuid),
  public.oauth_authorize(text, uuid, text[], text, text, text, text), public.revoke_oauth_grant(uuid),
  public.agent_auth_server_request(), public.agent_auth_require_server(),
  public.oauth_get_client(text), public.oauth_save_client(text, text, text[], text, jsonb),
  public.oauth_exchange_code(text, text, text, text, text, text, text, integer, integer),
  public.oauth_refresh(text, text, text, text[], text, text, integer, integer),
  public.oauth_revoke_token(text, text),
  public.resolve_agent_key(text), public.resolve_oauth_token(text, text),
  public.agent_call_counts(uuid), public.record_agent_call(uuid, uuid, text, text, boolean, text, integer, text)
  to service_role, space_runtime;

notify pgrst, 'reload schema';
