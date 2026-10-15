-- PROFILES: WHO ACTED, BY ID
-- 20261030000000_who_acted.sql copied the acting person's name onto each row as
-- text. Rows now point at public.profiles (one per auth user) instead, and screens
-- read the current name from there, so a rename shows everywhere. AI rows keep
-- their model id (change_sets.model_version, line_revisions.model_version and, new
-- here, revisions.model_version).
--
-- The server still sends the signed-in person on every request (lib/supabase/admin.ts):
--   x-person-id  their auth user id (the name header is gone)
--   x-via        where the request came from: app, api (an API-key capture) or script

-- =====================================================================
-- PROFILES: one row per account, kept in step with auth.users
-- =====================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Read by every signed-in user; written only by the server (set_profile_name)
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated using (true);

-- A sign-in's profile name, when it gave one (read through jsonb: the column only exists on Supabase)
create or replace function change_control.metadata_name(p_user jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(trim(coalesce(p_user -> 'raw_user_meta_data' ->> 'full_name', p_user -> 'raw_user_meta_data' ->> 'name')), '')
$$;

create or replace function change_control.sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, change_control.metadata_name(to_jsonb(new)))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end $$;

create trigger sync_profile after insert or update of email on auth.users
  for each row execute function change_control.sync_profile();

insert into public.profiles (id, email, display_name)
select u.id, u.email, change_control.metadata_name(to_jsonb(u)) from auth.users u
on conflict (id) do nothing;

-- RENAME (Settings): the server passes the signed-in person's id
create or replace function public.set_profile_name(p_person_id uuid, p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set display_name = nullif(trim(p_name), ''), updated_at = now() where id = p_person_id
$$;

revoke execute on function public.set_profile_name(uuid, text) from public, anon, authenticated;
grant execute on function public.set_profile_name(uuid, text) to service_role;

-- =====================================================================
-- COLUMNS
-- =====================================================================

alter table public.change_sets add column author_id uuid references public.profiles (id) on delete set null;
alter table public.revisions
  add column author_id uuid references public.profiles (id) on delete set null,
  add column model_version text;
alter table public.line_revisions add column author_id uuid references public.profiles (id) on delete set null;
alter table public.exceptions add column resolved_by_id uuid references public.profiles (id) on delete set null;
alter table public.shift_events add column via text;
alter table public.entities add column description_model text;

update public.shift_events set person_id = null
where person_id is not null and person_id not in (select id from public.profiles);
alter table public.shift_events
  add constraint shift_events_person_id_fkey foreign key (person_id) references public.profiles (id) on delete set null;

-- =====================================================================
-- BACKFILL: the name copies become ids, the AI's model moves to its own column
-- =====================================================================

update public.change_sets c set author_id = p.id from public.profiles p
where c.proposed_by = 'person' and c.author_name in (p.email, p.display_name);
update public.revisions r set author_id = p.id from public.profiles p
where r.author = 'person' and r.author_name in (p.email, p.display_name);
update public.line_revisions r set author_id = p.id from public.profiles p
where r.author = 'person' and r.author_name in (p.email, p.display_name);
update public.exceptions x set resolved_by_id = p.id from public.profiles p
where x.resolved_by_name in (p.email, p.display_name);
update public.revisions set model_version = author_name where author = 'ai';
update public.shift_events set via = 'app' where person_id is not null;

-- =====================================================================
-- THE PERSON ON THIS REQUEST: their profile id, or null (no header, or no such profile)
-- =====================================================================

create or replace function change_control.current_person_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles where id = change_control.request_header('x-person-id')::uuid;
  return v_id;
exception when others then
  return null;
end $$;

-- The person named on an event (a person's change written after the request, e.g. in tests)
create or replace function change_control.event_person_id(p_event_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select person_id from public.shift_events where id = p_event_id
$$;

-- =====================================================================
-- STAMPS (same triggers as who_acted, now writing ids)
-- =====================================================================

create or replace function change_control.stamp_event_person()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.person_id := coalesce(new.person_id, change_control.current_person_id());
  new.via := coalesce(new.via, change_control.request_header('x-via'));
  return new;
end $$;

create or replace function change_control.stamp_change_set_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.proposed_by = 'person' and new.author_id is null then
    new.author_id := coalesce(change_control.current_person_id(), change_control.event_person_id(new.event_id));
  end if;
  return new;
end $$;

create or replace function change_control.stamp_line_revision_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author = 'person' and new.author_id is null then
    new.author_id := coalesce(change_control.current_person_id(), change_control.event_person_id(new.event_id));
  end if;
  return new;
end $$;

create or replace function change_control.stamp_revision_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author = 'person' and new.author_id is null then
    new.author_id := coalesce(change_control.current_person_id(), change_control.event_person_id(new.event_id));
  elsif new.author = 'ai' and new.model_version is null then
    new.model_version := change_control.event_model(new.event_id);
  end if;
  return new;
end $$;

create or replace function change_control.stamp_exception_resolver()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.resolved_at is null and new.resolved_at is not null and new.resolved_by_id is null then
    new.resolved_by_id := change_control.current_person_id();
  end if;
  return new;
end $$;

-- =====================================================================
-- DROP THE NAME COPIES
-- =====================================================================

drop function change_control.current_person_name();
drop function change_control.event_person_name(uuid);

alter table public.shift_events drop column person_name;
alter table public.change_sets drop column author_name;
alter table public.revisions drop column author_name;
alter table public.line_revisions drop column author_name;
alter table public.exceptions drop column resolved_by_name;

-- =====================================================================
-- SECTION LINES: also who wrote each line (new columns go last)
-- =====================================================================

create or replace view public.section_lines with (security_invoker = true) as
select l.id as line_id, l.section_id, s.page_id, l.position, lr.id as line_revision_id, lr.content,
       lr.unit_revision_ids, lr.author, lr.model_version, l.last_changed_at,
       exists (select 1 from public.stale_lines sl where sl.line_id = l.id) as is_stale,
       lr.author_id
from public.lines l
join public.line_revisions lr on lr.id = l.current_revision_id
join public.sections s on s.id = l.section_id
where l.retired_at is null;
