-- Complete, atomic input; source text is evidence, never reviewer instructions.
create or replace function public.page_review_snapshot(p_page_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
with article_lines as (
 select l.* from public.section_lines l where l.page_id=p_page_id and exists(select 1 from public.sections s where s.id=l.section_id and s.retired_at is null)
), claims as (
 select r.* from public.revisions r where r.id in (select unnest(unit_revision_ids) from article_lines)
), evidence as (
 select p.* from public.passages p where p.id in (select unnest(passage_ids) from claims)
)
select jsonb_build_object(
 'page',(select to_jsonb(p) from public.pages p where id=p_page_id and retired_at is null),
 'sections',coalesce((select jsonb_agg(to_jsonb(s) order by position,id) from public.sections s where page_id=p_page_id and retired_at is null),'[]'),
 'lines',coalesce((select jsonb_agg(to_jsonb(l) order by section_id,position,line_id) from article_lines l),'[]'),
 'claims',coalesce((select jsonb_agg(to_jsonb(c) order by id) from claims c),'[]'),
 'passages',coalesce((select jsonb_agg(to_jsonb(e) order by id) from evidence e),'[]'),
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title) order by id) from public.sources where id in (select source_id from evidence)),'[]'),
 'pages',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'slug',slug,'parent_page_id',parent_page_id) order by id) from public.pages where retired_at is null),'[]'));
$$;

create table public.page_review_runs (
 id uuid primary key default gen_random_uuid(), page_id uuid not null references public.pages(id),
 created_at timestamptz not null default now(), summary text not null,
 edits integer not null, exceptions integer not null, change_set_id uuid references public.change_sets(id), snapshot_hash text not null
);
create index page_review_runs_page_idx on public.page_review_runs(page_id,created_at desc);
alter table public.page_review_runs enable row level security;
grant select on public.page_review_runs to authenticated;
create policy page_review_runs_read on public.page_review_runs for select to authenticated using(true);

create function change_control.review_normalized_text(p_text text) returns text
language sql immutable set search_path='' as $$
 select btrim(regexp_replace(regexp_replace(regexp_replace(lower(p_text),'\mtake place\M','occur','g'),'\mthe\M','','g'),'[^[:alnum:]]+',' ','g'));
$$;

create function public.complete_page_review(p_page_id uuid,p_snapshot jsonb,p_review jsonb,p_edits jsonb,p_trace jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare findings jsonb; edit jsonb; submitted jsonb; cs uuid; ev uuid; a public.actions; l public.lines; s public.sections; lr public.line_revisions; draft jsonb:='[]';
begin
 lock table public.pages,public.sections,public.lines,public.line_revisions,public.units,public.revisions,public.passages,public.sources in share row exclusive mode;
 if p_snapshot is distinct from public.page_review_snapshot(p_page_id) then raise exception 'The page or evidence changed. Run the review again.'; end if;
 if jsonb_typeof(p_edits) is distinct from 'array' or jsonb_array_length(p_edits)>24 then raise exception 'Invalid edits'; end if;
 if exists(select 1 from jsonb_array_elements(p_edits) e group by e->>'targetId' having count(*)>1) then raise exception 'Conflicting edits'; end if;
 for edit in select value from jsonb_array_elements(p_edits) loop
   if edit->>'type'='revise_line' then
     select * into l from public.lines where id=(edit->>'targetId')::uuid and retired_at is null;
     select * into s from public.sections where id=l.section_id and page_id=p_page_id and retired_at is null and mode='generated';
     select * into lr from public.line_revisions where id=l.current_revision_id;
     if s.id is null or lr.author is distinct from 'ai' or nullif(btrim(edit->>'text'),'') is null or length(edit->>'text')>12000 then raise exception 'Invalid line rewrite'; end if;
     draft:=draft||jsonb_build_array(jsonb_build_object('type','revise_line','targetId',l.id,'input',jsonb_build_object(
       'content',edit->>'text','unitRevisionIds',to_jsonb(lr.unit_revision_ids),'expectedLineRevisionId',lr.id,'reason',edit->>'reason')));
   elsif edit->>'type'='rename_section' then
     select * into s from public.sections where id=(edit->>'targetId')::uuid and page_id=p_page_id and retired_at is null and mode='generated';
     if s.id is null or lower(s.title)='overview' or nullif(btrim(edit->>'text'),'') is null or length(edit->>'text')>150 or lower(edit->>'text')='overview'
        or exists(select 1 from public.sections where page_id=p_page_id and retired_at is null and id<>s.id and lower(title)=lower(edit->>'text')) then raise exception 'Invalid heading'; end if;
     draft:=draft||jsonb_build_array(jsonb_build_object('type','rename_section','targetId',s.id,'input',jsonb_build_object('title',edit->>'text','reason',edit->>'reason')));
   elsif edit->>'type'='retire_section' then
     select * into s from public.sections where id=(edit->>'targetId')::uuid and page_id=p_page_id and retired_at is null and mode='generated';
     if s.id is null or lower(s.title)='overview' or not exists(select 1 from public.lines where section_id=s.id and retired_at is null) then raise exception 'Invalid duplicate section'; end if;
     -- Every line must have a verbatim-equivalent, identically cited survivor in Overview.
     if exists(select 1 from public.lines dl join public.line_revisions dr on dr.id=dl.current_revision_id
       where dl.section_id=s.id and dl.retired_at is null and (dr.author<>'ai' or cardinality(dr.unit_revision_ids)=0 or not exists(
         select 1 from public.lines kl join public.line_revisions kr on kr.id=kl.current_revision_id join public.sections ks on ks.id=kl.section_id
         where ks.page_id=p_page_id and ks.retired_at is null and lower(ks.title)='overview' and kl.retired_at is null
           and change_control.review_normalized_text(kr.content)=change_control.review_normalized_text(dr.content)
           and kr.unit_revision_ids @> dr.unit_revision_ids and dr.unit_revision_ids @> kr.unit_revision_ids))) then raise exception 'Section contains distinct information; an exception is required'; end if;
     -- Do not rewrite the surviving introduction in the same repair.
     if exists(select 1 from jsonb_array_elements(p_edits) e join public.lines el on el.id=(e->>'targetId')::uuid join public.sections es on es.id=el.section_id where e->>'type'='revise_line' and lower(es.title)='overview') then raise exception 'Keep the introduction intact while consolidating'; end if;
     draft:=draft||jsonb_build_array(jsonb_build_object('type','retire_section','targetId',s.id,'input',jsonb_build_object('reason',edit->>'reason')));
   else raise exception 'Unsupported editorial edit'; end if;
 end loop;
 findings:=public.record_page_review(p_page_id,p_snapshot,p_review,p_trace);
 if jsonb_array_length(draft)>0 then
   submitted:=public.submit_change_set(null,'edit','ai','Page reviewer: '||(p_snapshot->'page'->>'title'),p_trace,draft);
   cs:=(submitted->>'changeSetId')::uuid; ev:=(submitted->>'eventId')::uuid;
   update public.change_sets set actor_attribution=jsonb_build_object('proposedBy',jsonb_build_object('role','reviewer','model',p_trace->>'modelVersion'),'decidedBy',jsonb_build_object('role','reviewer','model',p_trace->>'modelVersion')) where id=cs;
   for a in select * from public.actions where change_set_id=cs order by position loop
     perform change_control.apply_action(a,ev,'ai');
   end loop;
   perform change_control.refresh_status(cs);
 end if;
 insert into public.page_review_runs(page_id,summary,edits,exceptions,change_set_id,snapshot_hash)
 values(p_page_id,p_review->>'summary',jsonb_array_length(draft),(findings->>'exceptions')::integer,cs,md5(public.page_review_snapshot(p_page_id)::text));
 return findings||jsonb_build_object('edits',jsonb_array_length(draft),'changeSetId',cs,'summary',p_review->>'summary');
end $$;

create function public.page_review_status(p_page_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('latest',(select to_jsonb(r) from public.page_review_runs r where page_id=p_page_id order by created_at desc limit 1),
 'openExceptions',(select count(*) from public.exceptions e join public.actions a on a.id=e.action_id where a.type='review_page' and a.target_id=p_page_id and e.status='open'));
$$;
revoke all on function public.complete_page_review(uuid,jsonb,jsonb,jsonb,jsonb),public.page_review_status(uuid),change_control.review_normalized_text(text) from public,anon,authenticated;
grant execute on function public.complete_page_review(uuid,jsonb,jsonb,jsonb,jsonb),public.page_review_status(uuid) to service_role;

create function public.pages_needing_editorial_review(p_section_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(p.id order by p.id),'[]') from public.pages p
 where p.retired_at is null and p.id in(select page_id from public.sections where id=any(p_section_ids))
 and not exists(select 1 from public.sections where page_id=p.id and retired_at is null and status<>'current')
 and exists(select 1 from public.section_lines l join public.sections s on s.id=l.section_id where l.page_id=p.id and s.retired_at is null)
 and md5(public.page_review_snapshot(p.id)::text) is distinct from (select snapshot_hash from public.page_review_runs where page_id=p.id order by created_at desc limit 1);
$$;

create function public.page_review_related(p_revision_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('unitId',u.id,'revisionId',r.id,'content',r.content,'epistemicStatus',u.epistemic_status,
 'passages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'text',p.text,'sourceId',p.source_id)) from public.passages p where p.id=any(r.passage_ids)),'[]'),
 'pages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'slug',p.slug)) from public.pages p where p.retired_at is null and p.id in (
   select s.page_id from public.sections s join public.section_lines l on l.section_id=s.id where s.retired_at is null and r.id=any(l.unit_revision_ids))),'[]')) order by u.id),'[]')
 from public.units u join public.revisions r on r.id=u.current_revision_id where u.retired_at is null and r.id=any(p_revision_ids);
$$;
revoke all on function public.pages_needing_editorial_review(uuid[]),public.page_review_related(uuid[]) from public,anon,authenticated;
grant execute on function public.pages_needing_editorial_review(uuid[]),public.page_review_related(uuid[]) to service_role;


