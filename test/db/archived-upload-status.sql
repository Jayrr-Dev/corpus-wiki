-- Run inside a transaction and roll back; no fixture changes survive.
do $$
declare source uuid; stalled uuid; completed uuid; held uuid;
begin
  select id into source from public.sources where archived_at is not null limit 1;
  if source is null then raise exception 'Requires an archived source fixture'; end if;
  update public.sources set archived_at = null where id = source;
  insert into public.shift_events(cause, actor, source_id, status)
    values ('upload', 'ai', source, 'reconciling') returning id into stalled;
  insert into public.shift_events(cause, actor, source_id, status)
    values ('upload', 'ai', source, 'applied') returning id into completed;
  insert into public.shift_events(cause, actor, source_id, status)
    values ('upload', 'ai', source, 'checking') returning id into held;
  insert into public.change_sets(event_id, proposed_by, status, summary)
    values (held, 'ai', 'checking', 'Pending approval test');
  update public.sources set archived_at = now(), archive_reason = 'Test archive' where id = source;
  if not exists (select 1 from public.shift_events where id = stalled and status = 'failed'
      and finished_at is not null and error like '%Test archive%') then
    raise exception 'Archived upload remains processing or has no explanation';
  end if;
  if (select status from public.shift_events where id = completed) <> 'applied' then
    raise exception 'Completed upload was overwritten';
  end if;
  if (select status from public.shift_events where id = held) <> 'checking' then
    raise exception 'Submitted change set was overwritten';
  end if;
end $$;
