-- One automatic replacement assessment per article snapshot and illustration run.
-- Remember failed/no-op attempts too, so hidden images cannot cause paid loops.
alter table public.composer_jobs add column assessed_illustration_run uuid;
create or replace function claim_composer_job(p_page_id uuid default null,p_automatic boolean default true) returns jsonb
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
      and (j.assessed_snapshot is distinct from composer_page_snapshot(j.page_id)
        or (j.outcome is distinct from 'manual' and exists(
          select 1 from composer_runs r where r.page_id=j.page_id and r.active
            and j.assessed_illustration_run is distinct from r.id
            and coalesce((read_composer_run(j.page_id)->>'omittedFigureCount')::integer,0)>0
        )))
      and not exists(select 1 from sections s where s.page_id=j.page_id and s.retired_at is null and s.status<>'current')
    ))
    and jsonb_array_length(coalesce(composer_page_snapshot(j.page_id)->'paragraphs','[]'))>0
  order by j.requested_at,j.page_id for update of j skip locked limit 1;
  if not found then return null; end if;
  snap:=composer_page_snapshot(job.page_id); new_token:=gen_random_uuid();
  update composer_jobs set token=new_token,lease_until=now()+interval '20 minutes',claimed_snapshot=snap where page_id=job.page_id;
  return jsonb_build_object('pageId',job.page_id,'token',new_token,'snapshot',snap);
end $$;

create or replace function finish_composer_job(p_page_id uuid,p_token uuid,p_error text default null) returns void
language plpgsql security definer set search_path=public as $$
begin
  update composer_jobs set assessed_snapshot=claimed_snapshot,
    assessed_illustration_run=(select id from composer_runs where page_id=p_page_id and active),token=null,lease_until=null,
    outcome=case when p_error is null then 'completed' else 'failed' end,error=left(p_error,1000),finished_at=now()
  where page_id=p_page_id and token=p_token;
end $$;
-- Include existing pages whose drawings became invalid under the evidence guard.
insert into public.composer_jobs(page_id)
  select distinct page_id from public.composer_runs where active
  on conflict(page_id) do nothing;
notify pgrst,'reload schema';
