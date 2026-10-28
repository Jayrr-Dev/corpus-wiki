-- Apply all runs merges before new articles. A merge places claims on an
-- article that already exists. A new article has to be written, so it waits.
--
-- placed_unit_ids answers "which of these claims already sit on an article?"
-- without loading article text. The old check read section_knowledge, which
-- also loads every cited revision.

create or replace function public.claim_suggestion_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.article_suggestions; r public.suggestion_runs; token uuid := gen_random_uuid();
begin
 update public.article_suggestions set status='failed',note=coalesce(note,'Applying stopped three times. Accept it again to retry.'),lease_token=null,lease_until=null
  where space_id=public.current_space_id() and status='accepting' and attempts>=3 and lease_until<now();
 update public.suggestion_runs set state='failed',error=coalesce(error,'The run stopped three times.'),lease_token=null,lease_until=null,finished_at=now()
  where space_id=public.current_space_id() and state='running' and attempts>=3 and lease_until<now();

 select * into s from public.article_suggestions
  where space_id=public.current_space_id() and status='accepting' and (lease_until is null or lease_until<now())
  order by (kind <> 'merge'), decided_at, id for update skip locked limit 1;
 if s.id is not null then
  update public.article_suggestions set lease_token=token,lease_until=now()+interval '15 minutes',attempts=attempts+1 where id=s.id;
  return jsonb_build_object('kind','apply','id',s.id,'token',token);
 end if;

 select * into r from public.suggestion_runs
  where space_id=public.current_space_id() and state in ('queued','running') and (lease_until is null or lease_until<now())
  order by created_at,id for update skip locked limit 1;
 if r.id is not null then
  update public.suggestion_runs set state='running',lease_token=token,lease_until=now()+interval '10 minutes',attempts=attempts+1,
   started_at=coalesce(started_at,now()) where id=r.id;
  return jsonb_build_object('kind','run','id',r.id,'token',token);
 end if;
 return null;
end $$;

create or replace function public.placed_unit_ids(p_unit_ids uuid[]) returns setof uuid
language sql stable security definer set search_path='' as $$
  select wanted.id
  from unnest(p_unit_ids) as wanted(id)
  where exists (
    select 1
    from public.section_inputs si
    join public.sections sec on sec.id = si.section_id and sec.retired_at is null
    join public.pages pg on pg.id = sec.page_id and pg.retired_at is null and pg.article_type is not null
    where si.unit_id = wanted.id
  )
  union
  select wanted.id
  from unnest(p_unit_ids) as wanted(id)
  join public.sections sec
    on sec.retired_at is null
   and jsonb_typeof(sec.query -> 'unitIds') = 'array'
   and (sec.query -> 'unitIds') ? wanted.id::text
  join public.pages pg on pg.id = sec.page_id and pg.retired_at is null and pg.article_type is not null;
$$;

-- space_runtime can own the function only while it may create objects in public.
grant create on schema public to space_runtime;
alter function public.placed_unit_ids(uuid[]) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke all on function public.placed_unit_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.placed_unit_ids(uuid[]) to service_role, space_runtime;
notify pgrst, 'reload schema';
