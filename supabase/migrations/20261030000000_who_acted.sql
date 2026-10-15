-- WHO ACTED, BY NAME
-- actor_kind says only 'ai' or 'person'. Every change now also names who: the
-- signed-in person, or the AI model that drafted it.
--
-- The server writes with the secret key, so auth.uid() is empty here. Instead the
-- server's admin client sends the signed-in person on every request (lib/supabase/admin.ts):
--   x-person-id    their auth user id
--   x-person-name  their display name, base64 of UTF-8 (headers are ASCII)
-- Triggers below stamp those onto the rows as they are written, so no database
-- function had to change its arguments. Tests and background jobs send no headers:
-- the person columns stay null there, and the AI's model still names AI rows.

-- =====================================================================
-- COLUMNS
-- =====================================================================

-- The signed-in person whose request started the event (an edit, an upload, an undo)
alter table public.shift_events
  add column person_id uuid,
  add column person_name text;

-- Who wrote it: the person's name, or the AI model id
alter table public.change_sets add column author_name text;
alter table public.revisions add column author_name text;
alter table public.line_revisions add column author_name text;

-- Who accepted or rejected the exception
alter table public.exceptions add column resolved_by_name text;

-- =====================================================================
-- THE PERSON ON THIS REQUEST (null outside a signed-in request)
-- =====================================================================

create or replace function change_control.request_header(p_name text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> p_name, '');
exception when others then
  return null;
end $$;

create or replace function change_control.current_person_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  return change_control.request_header('x-person-id')::uuid;
exception when others then
  return null;
end $$;

create or replace function change_control.current_person_name()
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(convert_from(decode(change_control.request_header('x-person-name'), 'base64'), 'UTF8'), '');
exception when others then
  return null;
end $$;

-- The person named on an event (a person's edit made outside a request, e.g. an undo in a test)
create or replace function change_control.event_person_name(p_event_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select person_name from public.shift_events where id = p_event_id
$$;

-- =====================================================================
-- STAMPS
-- =====================================================================

create or replace function change_control.stamp_event_person()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.person_id := coalesce(new.person_id, change_control.current_person_id());
  new.person_name := coalesce(new.person_name, change_control.current_person_name());
  return new;
end $$;

create trigger stamp_person before insert on public.shift_events
  for each row execute function change_control.stamp_event_person();

create or replace function change_control.stamp_change_set_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_name is null then
    new.author_name := case new.proposed_by
      when 'person' then coalesce(change_control.current_person_name(), change_control.event_person_name(new.event_id))
      else new.model_version
    end;
  end if;
  return new;
end $$;

create trigger stamp_author before insert on public.change_sets
  for each row execute function change_control.stamp_change_set_author();

create or replace function change_control.stamp_line_revision_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_name is null then
    new.author_name := case new.author
      when 'person' then coalesce(change_control.current_person_name(), change_control.event_person_name(new.event_id))
      else new.model_version
    end;
  end if;
  return new;
end $$;

create trigger stamp_author before insert on public.line_revisions
  for each row execute function change_control.stamp_line_revision_author();

-- A claim revision has no model column: the AI's model is the one on its event's latest change set
create or replace function change_control.event_model(p_event_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select model_version from public.change_sets
  where event_id = p_event_id and model_version is not null
  order by created_at desc
  limit 1
$$;

create or replace function change_control.stamp_revision_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_name is null then
    new.author_name := case new.author
      when 'person' then coalesce(change_control.current_person_name(), change_control.event_person_name(new.event_id))
      else change_control.event_model(new.event_id)
    end;
  end if;
  return new;
end $$;

create trigger stamp_author before insert on public.revisions
  for each row execute function change_control.stamp_revision_author();

create or replace function change_control.stamp_exception_resolver()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.resolved_at is null and new.resolved_at is not null and new.resolved_by_name is null then
    new.resolved_by_name := change_control.current_person_name();
  end if;
  return new;
end $$;

create trigger stamp_resolver before update on public.exceptions
  for each row execute function change_control.stamp_exception_resolver();

-- =====================================================================
-- BACKFILL
-- AI rows: their model. Person rows: the only account, when there is just one
-- (a single-user workspace); otherwise they stay unnamed.
-- =====================================================================

update public.change_sets set author_name = model_version where proposed_by = 'ai' and author_name is null;
update public.line_revisions set author_name = model_version where author = 'ai' and author_name is null;
update public.revisions r set author_name = change_control.event_model(r.event_id) where r.author = 'ai' and r.author_name is null;

do $$
declare
  v_id uuid;
  v_name text;
begin
  if (select count(*) from auth.users) <> 1 then
    return;
  end if;
  select id, email into v_id, v_name from auth.users;
  if v_name is null then
    return;
  end if;
  update public.shift_events set person_id = v_id, person_name = v_name
    where person_name is null and (actor = 'person' or cause = 'upload');
  update public.change_sets set author_name = v_name where proposed_by = 'person' and author_name is null;
  update public.line_revisions set author_name = v_name where author = 'person' and author_name is null;
  update public.revisions set author_name = v_name where author = 'person' and author_name is null;
  update public.exceptions set resolved_by_name = v_name where resolved_at is not null and resolved_by_name is null;
end $$;
