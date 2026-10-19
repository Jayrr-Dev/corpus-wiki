-- ARTICLE SUGGESTIONS (/units?view=suggestions). A run groups knowledge no
-- article cites and asks the AI for a new article or a merge per group. Runs
-- only save suggestions; a person's Accept applies one through change control.
-- Both the run and each accepted suggestion are leased jobs, so a closed tab,
-- a server restart or a lost response resumes where it stopped.
grant create on schema public to space_runtime;

create table public.suggestion_runs (
 id uuid primary key default gen_random_uuid(),
 space_id uuid not null default public.current_space_id() references public.spaces(id) on delete cascade,
 requested_by uuid,
 scope jsonb not null default '{}'::jsonb,
 state text not null default 'queued' check(state in ('queued','running','done','failed')),
 phase text,
 -- The deterministic groups, saved once so a resumed run asks about the same ones
 groups jsonb check(groups is null or jsonb_typeof(groups)='array'),
 done integer not null default 0,
 total integer not null default 0,
 suggested integer not null default 0,
 tokens_in integer not null default 0,
 tokens_out integer not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 attempts integer not null default 0,
 error text,
 created_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz,
 unique(space_id,id)
);
-- One active run per space
create unique index suggestion_runs_active on public.suggestion_runs(space_id) where state in ('queued','running');
create index suggestion_runs_recent on public.suggestion_runs(space_id,created_at desc);

create table public.article_suggestions (
 id uuid primary key default gen_random_uuid(),
 space_id uuid not null default public.current_space_id() references public.spaces(id) on delete cascade,
 run_id uuid not null,
 group_key text not null,
 kind text not null check(kind in ('create','merge')),
 page_id uuid,
 title text not null,
 article_type text check(article_type is null or article_type in ('entity','process','requirement','concept')),
 entity_id uuid,
 scope text not null default '',
 rationale text not null default '',
 -- [{title, sectionId|null, unitIds[]}]
 sections jsonb not null check(jsonb_typeof(sections)='array'),
 unit_ids uuid[] not null,
 revision_ids uuid[] not null,
 signals jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','accepting','applied','dismissed','stale','failed')),
 note text,
 result_page_id uuid,
 model text,
 tokens_in integer,
 tokens_out integer,
 lease_token uuid,
 lease_until timestamptz,
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 decided_by uuid,
 check(kind<>'merge' or page_id is not null),
 foreign key(space_id,run_id) references public.suggestion_runs(space_id,id) on delete cascade
);
create index article_suggestions_status on public.article_suggestions(space_id,status,created_at desc);
create index article_suggestions_run on public.article_suggestions(space_id,run_id);

do $$ declare t text; begin
 foreach t in array array['suggestion_runs','article_suggestions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('create policy space_server on public.%I for all to space_runtime using(space_id=(select public.current_space_id())) with check(space_id=(select public.current_space_id()))',t);
  execute format('create policy space_browser_boundary on public.%I for select to authenticated using(space_id=any(array(select unnest(public.readable_space_ids()))))',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to space_runtime',t);
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;

-- CLAIM THE NEXT JOB in this space: an accepted suggestion first (a person is
-- waiting on it), then a run. A job whose lease ran out is resumed; after
-- three attempts it fails with its last error instead of looping.
create function public.claim_suggestion_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.article_suggestions; r public.suggestion_runs; token uuid := gen_random_uuid();
begin
 update public.article_suggestions set status='failed',note=coalesce(note,'Applying stopped three times. Accept it again to retry.'),lease_token=null,lease_until=null
  where space_id=public.current_space_id() and status='accepting' and attempts>=3 and lease_until<now();
 update public.suggestion_runs set state='failed',error=coalesce(error,'The run stopped three times.'),lease_token=null,lease_until=null,finished_at=now()
  where space_id=public.current_space_id() and state='running' and attempts>=3 and lease_until<now();

 select * into s from public.article_suggestions
  where space_id=public.current_space_id() and status='accepting' and (lease_until is null or lease_until<now())
  order by decided_at,id for update skip locked limit 1;
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

-- Extend a lease while work continues; false means another worker took it over
create function public.renew_suggestion_lease(p_kind text,p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_kind='run' then
  update public.suggestion_runs set lease_until=now()+interval '10 minutes'
   where id=p_id and space_id=public.current_space_id() and lease_token=p_token and state='running';
 else
  update public.article_suggestions set lease_until=now()+interval '15 minutes'
   where id=p_id and space_id=public.current_space_id() and lease_token=p_token and status='accepting';
 end if;
 return found;
end $$;

-- Units held by a suggestion nobody has answered yet: runs and the Curator leave them alone
create function public.held_suggestion_units() returns setof uuid
language sql stable security definer set search_path='' as $$
 select distinct unnest(unit_ids) from public.article_suggestions
 where space_id=public.current_space_id() and status in ('pending','accepting')
$$;

alter function public.claim_suggestion_work() owner to space_runtime;
alter function public.renew_suggestion_lease(text,uuid,uuid) owner to space_runtime;
alter function public.held_suggestion_units() owner to space_runtime;
revoke create on schema public from space_runtime;
revoke all on function public.claim_suggestion_work(),public.renew_suggestion_lease(text,uuid,uuid),public.held_suggestion_units() from public,anon,authenticated;
grant execute on function public.claim_suggestion_work(),public.renew_suggestion_lease(text,uuid,uuid),public.held_suggestion_units() to service_role,space_runtime;
notify pgrst,'reload schema';
