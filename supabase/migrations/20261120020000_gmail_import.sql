-- =====================================================================
-- SECOND BRAIN · GMAIL IMPORT (behind the gmail_import feature flag)
-- =====================================================================
-- A person connects one Google account with the gmail.readonly scope,
-- picks labels, and imports each email thread as a source.
--
-- 1. TABLES
--    gmail_connections        one row per person: the account address, the
--                             OAuth tokens ENCRYPTED by the server (AES-256-GCM
--                             with GMAIL_TOKEN_KEY; the database never sees
--                             them in the clear), and the chosen label ids.
--    gmail_imported_threads   every thread already imported into a Space, so
--                             a re-run only adds new threads.
--    B-tree indexes only (OrioleDB). label_ids is a plain array, unindexed.
-- 2. ACCESS: nobody reads or writes the tables directly. Service requests
--    run as space_runtime, so every function is SECURITY DEFINER and keeps
--    the migration role as owner. Only the server's secret key may call them.
-- 3. DISCONNECT deletes the connection row, and with it the tokens. The
--    imported-thread list stays, so reconnecting never imports a thread twice.
-- =====================================================================

create table public.gmail_connections (
  person_id uuid primary key references auth.users (id) on delete cascade,
  account_email text not null check (length(btrim(account_email)) between 3 and 320),
  token_cipher text not null check (token_cipher like 'v1.%'),
  label_ids text[] not null default '{}' check (cardinality(label_ids) <= 100),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_import_at timestamptz
);
comment on table public.gmail_connections is 'Gmail import: one connected Google account per person; tokens are encrypted by the server before they are stored.';

create table public.gmail_imported_threads (
  space_id uuid not null references public.spaces (id) on delete cascade,
  account_email text not null,
  thread_id text not null check (length(thread_id) between 1 and 200),
  source_id uuid references public.sources (id) on delete set null,
  imported_at timestamptz not null default now(),
  primary key (space_id, account_email, thread_id)
);
comment on table public.gmail_imported_threads is 'Gmail import: threads already imported into a Space (re-running an import skips them).';

alter table public.gmail_connections enable row level security;
alter table public.gmail_imported_threads enable row level security;
revoke all on public.gmail_connections, public.gmail_imported_threads from public, anon, authenticated;

-- READ: the person's connection (with the encrypted tokens, for the server only), or null
create function public.gmail_get_connection(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accountEmail', c.account_email,
    'tokenCipher', c.token_cipher,
    'labelIds', to_jsonb(c.label_ids),
    'connectedAt', c.connected_at,
    'lastImportAt', c.last_import_at)
  from public.gmail_connections c
  where c.person_id = p_person_id;
$$;

-- CONNECT: saves the account and its encrypted tokens; the label choice is kept
-- when the same account connects again
create function public.gmail_save_connection(p_person_id uuid, p_account_email text, p_token_cipher text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.gmail_connections (person_id, account_email, token_cipher)
  values (p_person_id, lower(btrim(p_account_email)), p_token_cipher)
  on conflict (person_id) do update
    set label_ids = case when public.gmail_connections.account_email = excluded.account_email
                         then public.gmail_connections.label_ids else '{}'::text[] end,
        account_email = excluded.account_email,
        token_cipher = excluded.token_cipher,
        connected_at = now(),
        updated_at = now();
$$;

-- REFRESH: a new access token (still encrypted) replaces the old one
create function public.gmail_save_tokens(p_person_id uuid, p_token_cipher text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.gmail_connections
    set token_cipher = p_token_cipher, updated_at = now()
    where person_id = p_person_id;
  return found;
end;
$$;

-- LABELS: the labels the next import reads
create function public.gmail_set_labels(p_person_id uuid, p_label_ids text[])
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.gmail_connections
    set label_ids = coalesce(p_label_ids, '{}'::text[]), updated_at = now()
    where person_id = p_person_id;
  return found;
end;
$$;

-- DISCONNECT: deletes the row and the tokens in it
create function public.gmail_delete_connection(p_person_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.gmail_connections where person_id = p_person_id;
  return found;
end;
$$;

-- IMPORT DONE: when the person last imported
create function public.gmail_mark_imported(p_person_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.gmail_connections set last_import_at = now() where person_id = p_person_id;
$$;

-- DUPLICATES: which of these threads the current Space already imported from this account
create function public.gmail_imported_thread_ids(p_account_email text, p_thread_ids text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(t.thread_id), '[]'::jsonb)
  from public.gmail_imported_threads t
  where t.space_id = public.current_space_id()
    and t.account_email = lower(btrim(p_account_email))
    and t.thread_id = any (coalesce(p_thread_ids, '{}'::text[]));
$$;

-- RECORD: one imported thread in the current Space (a second record of it is ignored)
create function public.gmail_record_thread(p_account_email text, p_thread_id text, p_source_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.gmail_imported_threads (space_id, account_email, thread_id, source_id)
  values (public.current_space_id(), lower(btrim(p_account_email)), p_thread_id, p_source_id)
  on conflict (space_id, account_email, thread_id) do nothing;
  return found;
end;
$$;

revoke execute on function
  public.gmail_get_connection(uuid),
  public.gmail_save_connection(uuid, text, text),
  public.gmail_save_tokens(uuid, text),
  public.gmail_set_labels(uuid, text[]),
  public.gmail_delete_connection(uuid),
  public.gmail_mark_imported(uuid),
  public.gmail_imported_thread_ids(text, text[]),
  public.gmail_record_thread(text, text, uuid)
  from public, anon, authenticated;
grant execute on function
  public.gmail_get_connection(uuid),
  public.gmail_save_connection(uuid, text, text),
  public.gmail_save_tokens(uuid, text),
  public.gmail_set_labels(uuid, text[]),
  public.gmail_delete_connection(uuid),
  public.gmail_mark_imported(uuid),
  public.gmail_imported_thread_ids(text, text[]),
  public.gmail_record_thread(text, text, uuid)
  to service_role, space_runtime;

notify pgrst, 'reload schema';
