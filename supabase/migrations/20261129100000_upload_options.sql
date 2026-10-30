-- =====================================================================
-- SECOND BRAIN · UPLOAD OPTIONS
-- =====================================================================
-- Switches per space on the Upload screen (lib/ingest/uploadOptions.ts):
--   autoApprove     accept new root domains an upload proposes instead
--                   of waiting (the Reviewer budget still asks)
-- Off by default.
-- =====================================================================

alter table public.workspace_settings
  add column upload_options jsonb not null default '{}'::jsonb;

grant create on schema public to space_runtime;

create function public.get_upload_options()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(s.upload_options, '{}'::jsonb)
  from (select 1) anchor
  left join public.workspace_settings s
    on s.id and s.space_id = public.current_space_id();
$$;

create function public.set_upload_options(p_options jsonb)
returns jsonb
language sql
set search_path = ''
as $$
  insert into public.workspace_settings (id, upload_options, updated_at)
  values (true, p_options, now())
  on conflict (space_id, id) do update
    set upload_options = excluded.upload_options, updated_at = excluded.updated_at;
  select public.get_upload_options();
$$;

-- The open questions an upload is waiting on, oldest first
create function public.open_upload_exceptions(p_event_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'reason', e.reason) order by e.created_at), '[]'::jsonb)
  from public.exceptions e
  join public.actions a on a.id = e.action_id
  join public.change_sets s on s.id = a.change_set_id
  where s.event_id = p_event_id and e.status = 'open';
$$;

alter function public.get_upload_options() owner to space_runtime;
alter function public.set_upload_options(jsonb) owner to space_runtime;
alter function public.open_upload_exceptions(uuid) owner to space_runtime;
revoke execute on function public.get_upload_options(), public.set_upload_options(jsonb), public.open_upload_exceptions(uuid) from public, anon, authenticated;
grant execute on function public.get_upload_options(), public.set_upload_options(jsonb), public.open_upload_exceptions(uuid) to service_role, space_runtime;

revoke create on schema public from space_runtime;
notify pgrst, 'reload schema';
