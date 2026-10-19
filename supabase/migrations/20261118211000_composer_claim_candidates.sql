-- Evaluate cheap queue eligibility before building article snapshots. The old
-- WHERE clause allowed expensive snapshot functions to run for unfinished
-- pages and evaluated the same snapshot repeatedly for settled candidates.
-- Reuse the caller's freshly read snapshot for illustration visibility too.
do $$
declare definition text; patched text; had_create boolean;
begin
  definition := pg_get_functiondef('public.read_composer_run(uuid)'::regprocedure);
  patched := replace(definition,'public.read_composer_run(p_page_id uuid)',
    'public.read_composer_run_snapshot(p_page_id uuid, p_snapshot jsonb)');
  patched := replace(patched,'current_snapshot:=composer_page_snapshot(p_page_id);','current_snapshot:=p_snapshot;');
  if patched=definition or position('current_snapshot:=p_snapshot;' in patched)=0 then
    raise exception 'Composer visibility function changed; review snapshot reuse';
  end if;
  execute patched;
  had_create := has_schema_privilege('space_runtime','public','CREATE');
  if not had_create then grant create on schema public to space_runtime; end if;
  alter function public.read_composer_run_snapshot(uuid,jsonb) owner to space_runtime;
  if not had_create then revoke create on schema public from space_runtime; end if;
end $$;
revoke all on function public.read_composer_run_snapshot(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_composer_run_snapshot(uuid,jsonb) to space_runtime,service_role;

create or replace function public.claim_composer_job(p_page_id uuid default null,p_automatic boolean default true) returns jsonb
language plpgsql security definer set search_path=public as $$
declare candidate record; snap jsonb; new_token uuid; active_run uuid; needs_replacement boolean;
begin
  if p_page_id is not null then
    insert into composer_jobs(page_id) select id from pages where id=p_page_id and retired_at is null on conflict do nothing;
  end if;
  for candidate in
    select j.page_id,j.outcome,j.assessed_illustration_run,(j.assessed_snapshot::text)::jsonb as assessed_snapshot
    from composer_jobs j join pages p on p.id=j.page_id
    where p.retired_at is null and (p_page_id is null or j.page_id=p_page_id)
      and (j.token is null or j.lease_until<now())
      and (not p_automatic or (
        j.requested_at<now()-interval '20 seconds'
        and not exists(select 1 from sections s where s.page_id=j.page_id and s.retired_at is null and s.status<>'current')
      ))
    order by j.requested_at,j.page_id for update of j skip locked
  loop
    snap := (composer_page_snapshot(candidate.page_id)::text)::jsonb;
    if jsonb_array_length(coalesce(snap->'paragraphs','[]'))=0 then continue; end if;
    if p_automatic and candidate.assessed_snapshot is not distinct from snap then
      needs_replacement := false;
      if candidate.outcome is distinct from 'manual' then
        select r.id into active_run from composer_runs r where r.page_id=candidate.page_id and r.active
          and candidate.assessed_illustration_run is distinct from r.id;
        if active_run is not null then
          needs_replacement := coalesce((read_composer_run_snapshot(candidate.page_id,snap)->>'omittedFigureCount')::integer,0)>0;
          if not needs_replacement then
            -- Remember a negative visibility assessment too. Without this,
            -- unchanged drawings were fully checked on every worker tick.
            -- Bound this expensive assessment to one candidate per call so
            -- the no-op cursor commits before the RPC time budget expires.
            update composer_jobs set assessed_illustration_run=active_run where page_id=candidate.page_id;
            return null;
          end if;
        end if;
      end if;
      if not needs_replacement then continue; end if;
    end if;
    new_token := gen_random_uuid();
    update composer_jobs set token=new_token,lease_until=now()+interval '20 minutes',claimed_snapshot=snap where page_id=candidate.page_id;
    return jsonb_build_object('pageId',candidate.page_id,'token',new_token,'snapshot',snap);
  end loop;
  return null;
end $$;
