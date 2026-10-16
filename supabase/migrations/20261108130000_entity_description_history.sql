-- =====================================================================
-- SECOND BRAIN · ENTITY DESCRIPTION HISTORY
-- =====================================================================
-- Every version of an entity's AI description, kept like line_revisions so
-- the entity page can show what changed, preview an older version and
-- restore it. A trigger on entities writes a row whenever the description
-- changes, so the AI writers (upload, graph backfill) need no change.
-- A restore goes through restore_entity_description and is recorded as the
-- person's edit on top of the history.
-- =====================================================================

create table public.entity_description_revisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  description text not null,
  author public.actor_kind not null,
  author_id uuid,                              -- the person, for a restore
  model_version text,                          -- trace, when the AI wrote it
  restored_from_id uuid references public.entity_description_revisions (id) on delete set null
);
comment on table public.entity_description_revisions is 'One version of an entity description. Old versions are kept for history, preview and restore.';
create index entity_description_revisions_entity_idx on public.entity_description_revisions (entity_id, created_at desc);

-- RECORD: one row per changed description (a cleared description is not a version)
create function change_control.record_entity_description() returns trigger
language plpgsql security definer set search_path = '' as $$
declare restored uuid := nullif(current_setting('app.entity_description_restore', true), '')::uuid;
begin
  if new.description is null or new.description is not distinct from old.description then return new; end if;
  insert into public.entity_description_revisions (entity_id, description, author, author_id, model_version, restored_from_id, created_at)
  values (new.id, new.description,
    case when restored is null then 'ai' else 'person' end::public.actor_kind,
    case when restored is null then null else change_control.current_person_id() end,
    case when restored is null then new.description_model else null end,
    restored, coalesce(new.description_updated_at, now()));
  return new;
end $$;
create trigger entity_description_history after update of description on public.entities
  for each row execute function change_control.record_entity_description();
create trigger entity_description_history_insert after insert on public.entities
  for each row when (new.description is not null) execute function change_control.record_entity_description();

-- RESTORE: an older version becomes the current description, as a new version on top
create function public.restore_entity_description(p_revision_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare version public.entity_description_revisions;
begin
  select * into version from public.entity_description_revisions where id = p_revision_id;
  if version.id is null then raise exception 'This version no longer exists.'; end if;
  perform set_config('app.entity_description_restore', version.id::text, true);
  update public.entities set description = version.description, description_updated_at = now() where id = version.entity_id;
  perform set_config('app.entity_description_restore', '', true);
end $$;
revoke all on function public.restore_entity_description(uuid) from public, anon, authenticated;
grant execute on function public.restore_entity_description(uuid) to service_role;
revoke all on function change_control.record_entity_description() from public, anon, authenticated;

-- BACKFILL: today's descriptions become each entity's first version
insert into public.entity_description_revisions (entity_id, description, author, model_version, created_at)
select id, description, 'ai', description_model, coalesce(description_updated_at, created_at)
from public.entities where description is not null;

-- ACCESS: read by the signed-in user, written only by the trigger
alter table public.entity_description_revisions enable row level security;
revoke all on public.entity_description_revisions from anon, authenticated;
grant select on public.entity_description_revisions to authenticated;
create policy entity_description_revisions_read on public.entity_description_revisions for select to authenticated using (true);

notify pgrst, 'reload schema';
