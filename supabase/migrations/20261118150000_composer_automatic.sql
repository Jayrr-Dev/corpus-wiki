create table composer_jobs (
  page_id uuid primary key references pages(id) on delete cascade,
  requested_at timestamptz not null default now(),
  token uuid, lease_until timestamptz, claimed_snapshot jsonb, assessed_snapshot jsonb,
  outcome text, error text, finished_at timestamptz
);
alter table composer_jobs enable row level security;
revoke all on composer_jobs from anon,authenticated;

create function enqueue_composer_page(p_page_id uuid) returns void
language sql security definer set search_path=public as $$
  insert into composer_jobs(page_id) select id from pages where id=p_page_id and retired_at is null
  on conflict(page_id) do update set requested_at=now();
$$;
create function enqueue_composer_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  if tg_table_name='lines' then
    select page_id into target from sections where id=new.section_id;
  elsif tg_table_name='sections' then target:=new.page_id;
  else target:=new.id; end if;
  perform enqueue_composer_page(target);
  return new;
end $$;
create trigger composer_line_changed after insert or update of current_revision_id,retired_at,section_id on lines for each row execute function enqueue_composer_change();
create trigger composer_section_changed after insert or update of title,status,retired_at,position,page_id on sections for each row execute function enqueue_composer_change();
create trigger composer_page_changed after insert or update of title,slug,retired_at on pages for each row execute function enqueue_composer_change();

create function claim_composer_job(p_page_id uuid default null,p_automatic boolean default true) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job composer_jobs; snap jsonb; new_token uuid;
begin
  if p_page_id is not null then
    insert into composer_jobs(page_id) select id from pages where id=p_page_id and retired_at is null on conflict do nothing;
  end if;
  select j.* into job from composer_jobs j join pages p on p.id=j.page_id
  where p.retired_at is null and (p_page_id is null or j.page_id=p_page_id)
    and (j.token is null or j.lease_until<now())
    and (not p_automatic or (
      j.requested_at<now()-interval '20 seconds'
      and j.assessed_snapshot is distinct from composer_page_snapshot(j.page_id)
      and not exists(select 1 from sections s where s.page_id=j.page_id and s.retired_at is null and s.status<>'current')
    ))
    and jsonb_array_length(coalesce(composer_page_snapshot(j.page_id)->'paragraphs','[]'))>0
  order by j.requested_at,j.page_id for update of j skip locked limit 1;
  if not found then return null; end if;
  snap:=composer_page_snapshot(job.page_id); new_token:=gen_random_uuid();
  update composer_jobs set token=new_token,lease_until=now()+interval '20 minutes',claimed_snapshot=snap where page_id=job.page_id;
  return jsonb_build_object('pageId',job.page_id,'token',new_token,'snapshot',snap);
end $$;
create function renew_composer_job(p_page_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  update composer_jobs set lease_until=now()+interval '20 minutes' where page_id=p_page_id and token=p_token and lease_until>now();
  return found;
end $$;
create function finish_composer_job(p_page_id uuid,p_token uuid,p_error text default null) returns void
language plpgsql security definer set search_path=public as $$
begin
  update composer_jobs set assessed_snapshot=claimed_snapshot,token=null,lease_until=null,
    outcome=case when p_error is null then 'completed' else 'failed' end,error=left(p_error,1000),finished_at=now()
  where page_id=p_page_id and token=p_token;
end $$;

-- Carry over only figures whose supporting paragraphs are identical. Newly present
-- source media takes precedence over an older Composer illustration in that section.
create function read_composer_reusable_run(p_page_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_set(to_jsonb(r),'{composition,figures}',coalesce((
    select jsonb_agg(f) from jsonb_array_elements(r.composition->'figures') f
    where not exists(select 1 from jsonb_array_elements_text(f->'evidence') e where not exists(
      select 1 from jsonb_array_elements(r.snapshot->'paragraphs') old
      join jsonb_array_elements(composer_page_snapshot(p_page_id)->'paragraphs') cur on cur->>'id'=old->>'id'
      where old->>'id'=e and old->>'revisionId'=cur->>'revisionId' and old->>'text'=cur->>'text'
    )) and exists(select 1 from jsonb_array_elements(composer_page_snapshot(p_page_id)->'paragraphs') cur where cur->>'id'=f->>'after')
    and not exists(select 1 from jsonb_array_elements(composer_page_snapshot(p_page_id)->'paragraphs') cur where (cur->>'hasMedia')::boolean and cur->>'section'=(select p->>'section' from jsonb_array_elements(composer_page_snapshot(p_page_id)->'paragraphs') p where p->>'id'=f->>'after') and not exists(select 1 from jsonb_array_elements(r.snapshot->'paragraphs') old where old->>'id'=cur->>'id' and (old->>'hasMedia')::boolean))
  ),'[]'::jsonb)) from composer_runs r where r.page_id=p_page_id and r.active;
$$;
create function composer_section_asset_ids(p_line_ids text[]) returns jsonb
language sql stable security definer set search_path=public as $$
  with evidence as (
    select distinct unnest(rv.passage_ids) id from lines l join line_revisions lr on lr.id=l.current_revision_id join revisions rv on rv.id=any(lr.unit_revision_ids) where l.id::text=any(p_line_ids)
  ) select coalesce(jsonb_agg(a.id),'[]') from assets a where a.passage_ids && array(select id from evidence)
    or a.source_id in (select p.source_id from passages p join evidence e on e.id=p.id join sources s on s.id=p.source_id where s.mime_type like 'image/%' or s.mime_type like 'video/%');
$$;
create function suppress_composer_page(p_page_id uuid) returns void
language sql security definer set search_path=public as $$
  insert into composer_jobs(page_id,assessed_snapshot,outcome,finished_at) values(p_page_id,composer_page_snapshot(p_page_id),'manual',now())
  on conflict(page_id) do update set assessed_snapshot=excluded.assessed_snapshot,token=null,lease_until=null,outcome='manual',finished_at=now();
$$;
revoke all on function enqueue_composer_page(uuid),enqueue_composer_change(),claim_composer_job(uuid,boolean),renew_composer_job(uuid,uuid),finish_composer_job(uuid,uuid,text),read_composer_reusable_run(uuid),composer_section_asset_ids(text[]),suppress_composer_page(uuid) from public,anon,authenticated;
grant execute on function enqueue_composer_page(uuid),claim_composer_job(uuid,boolean),renew_composer_job(uuid,uuid),finish_composer_job(uuid,uuid,text),read_composer_reusable_run(uuid),composer_section_asset_ids(text[]),suppress_composer_page(uuid) to service_role;
notify pgrst,'reload schema';
