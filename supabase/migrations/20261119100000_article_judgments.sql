-- ARTICLE JUDGMENTS: what coverage discovery and scope selection already decided
-- about a claim revision for one article, so later passes skip it instead of
-- asking the model again. A judgment holds while its claim revision and its
-- basis (a hash of what the decision depended on: title, scope, prompt version
-- and, for already_covered, the article text) are unchanged. B-tree key only.
create table public.article_judgments (
 space_id uuid not null default public.current_space_id() references public.spaces(id) on delete cascade,
 page_id uuid not null,
 stage text not null check(stage in ('discovery','scope','outline')),
 subject text not null check(length(subject) between 1 and 200),
 revision_id uuid,
 basis text not null,
 decision text not null,
 reason text not null default '',
 judged_at timestamptz not null default now(),
 primary key(space_id,page_id,stage,subject),
 foreign key(space_id,page_id) references public.pages(space_id,id) on delete cascade
);
alter table public.article_judgments enable row level security;
alter table public.article_judgments force row level security;
create policy space_server on public.article_judgments for all to space_runtime
 using(space_id=(select public.current_space_id())) with check(space_id=(select public.current_space_id()));
create policy space_browser_boundary on public.article_judgments for select to authenticated
 using(space_id=any(array(select unnest(public.readable_space_ids()))));
grant select on public.article_judgments to authenticated;
grant select,insert,update,delete on public.article_judgments to space_runtime;

create function public.read_article_judgments(p_page_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('stage',j.stage,'subject',j.subject,'revisionId',j.revision_id,'basis',j.basis,'decision',j.decision,'reason',j.reason) order by j.stage,j.subject),'[]'::jsonb)
 from public.article_judgments j where j.page_id=p_page_id and j.space_id=public.current_space_id()
$$;
create function public.save_article_judgments(p_page_id uuid,p_stage text,p_judgments jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare saved integer;
begin
 if not exists(select 1 from public.pages where id=p_page_id and space_id=public.current_space_id() and retired_at is null) then raise exception 'Article is unavailable in this space'; end if;
 if jsonb_typeof(p_judgments) is distinct from 'array' then raise exception 'Invalid article judgments'; end if;
 insert into public.article_judgments(page_id,stage,subject,revision_id,basis,decision,reason)
 select distinct on(j->>'subject') p_page_id,p_stage,j->>'subject',nullif(j->>'revisionId','')::uuid,j->>'basis',j->>'decision',left(coalesce(j->>'reason',''),2000)
 from jsonb_array_elements(p_judgments) j order by j->>'subject'
 on conflict(space_id,page_id,stage,subject) do update set revision_id=excluded.revision_id,basis=excluded.basis,decision=excluded.decision,reason=excluded.reason,judged_at=now();
 get diagnostics saved=row_count;
 return saved;
end $$;
grant create on schema public to space_runtime;
alter function public.read_article_judgments(uuid) owner to space_runtime;
alter function public.save_article_judgments(uuid,text,jsonb) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke all on function public.read_article_judgments(uuid),public.save_article_judgments(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.read_article_judgments(uuid),public.save_article_judgments(uuid,text,jsonb) to service_role,space_runtime;
notify pgrst,'reload schema';
