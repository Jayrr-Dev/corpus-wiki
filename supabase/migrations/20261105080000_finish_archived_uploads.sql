-- An archived source cannot continue ingestion. Preserve completed changes and
-- approval exceptions; only finish uploads that never submitted a change set.
create function change_control.finish_archived_uploads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update public.shift_events e
    set status = 'failed', finished_at = now(),
        error = 'Processing stopped because this source was archived. ' || coalesce(new.archive_reason, 'Restore the source before re-running it.')
    where e.source_id = new.id and e.cause = 'upload'
      and e.status in ('received', 'extracting', 'reconciling', 'checking')
      and not exists (select 1 from public.change_sets c where c.event_id = e.id);
  end if;
  return new;
end $$;

create trigger sources_finish_archived_uploads after update of archived_at on public.sources
for each row execute function change_control.finish_archived_uploads();

-- Repair existing orphaned processing rows, including archives made before this trigger.
update public.shift_events e
set status = 'failed', finished_at = now(),
    error = 'Processing stopped because this source was archived. ' || coalesce(s.archive_reason, 'Restore the source before re-running it.')
from public.sources s
where e.source_id = s.id and s.archived_at is not null and e.cause = 'upload'
  and e.status in ('received', 'extracting', 'reconciling', 'checking')
  and not exists (select 1 from public.change_sets c where c.event_id = e.id);
