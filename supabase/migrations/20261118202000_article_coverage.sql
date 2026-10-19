-- Literal topic retrieval complements semantic top-k results. No non-B-tree
-- index: these space-scoped knowledge sets are small and run on OrioleDB.
create function public.article_knowledge_candidates(p_title text, p_scope text default '') returns jsonb
language sql stable security definer set search_path='' as $$
 with subject as (
   select trim(regexp_replace(left(p_title,500),'\([^)]*\)','','g')) main,
     plainto_tsquery('english'::regconfig,left(p_title,500)) query
 ), aliases as (
   select lower(trim(m[1])) phrase from regexp_matches(left(p_title,500),'\(([^)]+)\)','g') m
 ), candidates as (
   select u.id,ts_rank_cd(to_tsvector('english'::regconfig,r.content),s.query) rank
   from public.units u join public.revisions r on r.id=u.current_revision_id
   cross join subject s
   where u.space_id=public.current_space_id() and u.retired_at is null
     and (to_tsvector('english'::regconfig,r.content||' '||coalesce(r.knowledge_context::text,'')) @@ s.query
       or (length(s.main)>=4 and position(lower(s.main) in lower(r.content||' '||coalesce(r.knowledge_context::text,'')))>0)
       or exists(select 1 from aliases a where length(a.phrase)>=4
         and position(a.phrase in lower(r.content||' '||coalesce(r.knowledge_context::text,'')))>0))
   order by rank desc,u.id limit 500
 ) select coalesce(jsonb_agg(id),'[]'::jsonb) from candidates
$$;
grant create on schema public to space_runtime;
alter function public.article_knowledge_candidates(text,text) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke all on function public.article_knowledge_candidates(text,text) from public,anon,authenticated;
grant execute on function public.article_knowledge_candidates(text,text) to service_role,space_runtime;

-- Guard every caller, including review edits and direct finish_section_build.
-- Textless sections with selected evidence are unfinished work, not complete.
create function public.guard_empty_section_completion() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.mode='generated' and new.status='current' and new.retired_at is null
   and not exists(select 1 from public.section_lines l where l.section_id=new.id and length(trim(l.content))>0)
   and exists(select 1 from public.living_page_query_units(new.query)) then
   new.status:='stale';
   new.built_at:=null;
   new.building_since:=null;
 end if;
 return new;
end $$;
create trigger guard_empty_section_completion before insert or update of status on public.sections
 for each row execute function public.guard_empty_section_completion();

-- Repair the previously completed empty sections without altering saved text.
update public.sections set status='stale',built_at=null
 where mode='generated' and status='current' and retired_at is null
 and not exists(select 1 from public.section_lines l where l.section_id=sections.id and length(trim(l.content))>0)
 and exists(select 1 from public.living_page_query_units(sections.query));
notify pgrst,'reload schema';
