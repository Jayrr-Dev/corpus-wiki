-- Complete, atomic input; source text is evidence, never reviewer instructions.
create function public.page_review_snapshot(p_page_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
with article_lines as (
 select l.* from public.section_lines l where l.page_id=p_page_id
), claims as (
 select r.* from public.revisions r where r.id in (select unnest(unit_revision_ids) from article_lines)
), evidence as (
 select p.* from public.passages p where p.id in (select unnest(passage_ids) from claims)
)
select jsonb_build_object(
 'page',(select to_jsonb(p) from public.pages p where id=p_page_id),
 'sections',coalesce((select jsonb_agg(to_jsonb(s) order by position,id) from public.sections s where page_id=p_page_id),'[]'),
 'lines',coalesce((select jsonb_agg(to_jsonb(l) order by section_id,position,line_id) from article_lines l),'[]'),
 'claims',coalesce((select jsonb_agg(to_jsonb(c) order by id) from claims c),'[]'),
 'passages',coalesce((select jsonb_agg(to_jsonb(e) order by id) from evidence e),'[]'),
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title) order by id) from public.sources where id in (select source_id from evidence)),'[]'),
 'pages',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'slug',slug,'parent_page_id',parent_page_id) order by id) from public.pages),'[]'));
$$;

create function public.record_page_review(p_page_id uuid,p_snapshot jsonb,p_review jsonb,p_trace jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f jsonb; submitted jsonb; cs uuid; a uuid; count_new integer:=0; position_next integer:=0;
begin
 -- Serializes concurrent reviews and content changes through snapshot validation.
 lock table public.pages,public.sections,public.lines,public.line_revisions,public.units,public.revisions,public.passages,public.sources in share mode;
 perform pg_advisory_xact_lock(hashtext('page-review:'||p_page_id::text));
 if p_snapshot is distinct from public.page_review_snapshot(p_page_id) then raise exception 'The page or evidence changed. Run the review again.'; end if;
 if p_snapshot->'page' is null or p_snapshot->'page'='null'::jsonb then raise exception 'Page unavailable'; end if;
 if jsonb_typeof(p_review->'findings') is distinct from 'array' or jsonb_array_length(p_review->'findings')>6 then raise exception 'Invalid review'; end if;
 for f in select value from jsonb_array_elements(p_review->'findings') loop
   if f->>'operation' not in ('revise','consolidate','move','delete','investigate')
      or nullif(btrim(f->>'recommendation'),'') is null or nullif(btrim(f->>'quote'),'') is null
      or not exists(select 1 from jsonb_array_elements(p_snapshot->'lines') l where strpos(l->>'content',f->>'quote')>0)
      then raise exception 'Invalid editorial recommendation'; end if;
   if f->>'operation' in ('move','consolidate') and (f->>'destinationId' is null or f->>'destinationId'=p_page_id::text
      or not exists(select 1 from public.pages where id::text=f->>'destinationId')) then raise exception 'Invalid destination'; end if;
   if exists(select 1 from public.exceptions e join public.actions a on a.id=e.action_id
     where e.status='open' and a.type='review_page' and a.target_id=p_page_id
       and a.input->>'operation'=f->>'operation' and a.input->>'quote'=f->>'quote') then continue; end if;
   if cs is null then
     submitted:=public.submit_change_set(null,'edit','ai','Page review: '||(p_snapshot->'page'->>'title'),p_trace,'[]');
     cs:=(submitted->>'changeSetId')::uuid;
     update public.change_sets set actor_attribution=jsonb_build_object('proposedBy',jsonb_build_object('role','reviewer','model',p_trace->>'modelVersion')) where id=cs;
   end if;
   insert into public.actions(change_set_id,position,type,target_id,input,outcome)
     values(cs,position_next,'review_page',p_page_id,f||jsonb_build_object('pageSlug',p_snapshot->'page'->>'slug','pageTitle',p_snapshot->'page'->>'title'),'exception') returning id into a;
   insert into public.exceptions(action_id,reason,evidence) values(a,'domain_tree_review',jsonb_build_object('detail',f->>'reason','quote',f->>'quote'));
   position_next:=position_next+1; count_new:=count_new+1;
 end loop;
 if cs is not null then perform change_control.refresh_status(cs); end if;
 return jsonb_build_object('exceptions',count_new);
end $$;

-- Acknowledging a recommendation never executes a content operation.
alter function public.resolve_exception(uuid,boolean,text) rename to resolve_before_page_review;
create function public.resolve_exception(p_exception_id uuid,p_accept boolean,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x public.exceptions; a public.actions;
begin
 select * into x from public.exceptions where id=p_exception_id for update;
 select * into a from public.actions where id=x.action_id for update;
 if a.type is distinct from 'review_page'::public.action_type then return public.resolve_before_page_review(p_exception_id,p_accept,p_note); end if;
 perform 1 from public.change_sets where id=a.change_set_id for update;
 if x.status is distinct from 'open' then raise exception 'This exception is already answered.'; end if;
 update public.exceptions set status=case when p_accept then 'accepted' else 'rejected' end::public.exception_status,resolved_at=now(),note=p_note where id=x.id;
 update public.actions set outcome=case when p_accept then 'applied' else 'rejected' end::public.action_outcome,
   applied_at=case when p_accept then now() else null end where id=a.id;
 perform change_control.refresh_status(a.change_set_id);
 return jsonb_build_object('eventId',null);
end $$;

alter function change_control.undo_action(public.actions,uuid) rename to undo_before_page_review;
create function change_control.undo_action(p_action public.actions,p_revert_event_id uuid) returns void
language plpgsql set search_path='' as $$
begin
 if p_action.type='review_page' then
   update public.actions set outcome='reverted',reverted_by_event_id=p_revert_event_id where id=p_action.id;
 else perform change_control.undo_before_page_review(p_action,p_revert_event_id); end if;
end $$;

revoke all on function public.page_review_snapshot(uuid),public.record_page_review(uuid,jsonb,jsonb,jsonb),public.resolve_exception(uuid,boolean,text),public.resolve_before_page_review(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.page_review_snapshot(uuid),public.record_page_review(uuid,jsonb,jsonb,jsonb),public.resolve_exception(uuid,boolean,text) to service_role;
revoke execute on function change_control.undo_action(public.actions,uuid),change_control.undo_before_page_review(public.actions,uuid) from public,anon,authenticated;
