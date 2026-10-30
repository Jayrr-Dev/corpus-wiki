-- OUTLINE HOLD: when the Reviewer still objects to an article's re-planned outline
-- after its bounded repair rounds, the scaffold keeps the current structure and
-- raises one recommendation for a person, the same way a page review does
-- (a review_page action held in Exceptions; accepting it only records the
-- decision). Full auto acknowledges it like the Reviewer's other findings.
-- One open hold per article: later passes do not raise it again.
create function public.record_outline_hold(p_page_id uuid,p_finding jsonb,p_trace jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare page public.pages; submitted jsonb; cs uuid; a uuid;
begin
 select * into page from public.pages where id=p_page_id and space_id=public.current_space_id() and retired_at is null;
 if not found then raise exception 'Article is unavailable in this space'; end if;
 if nullif(btrim(p_finding->>'recommendation'),'') is null then raise exception 'Invalid outline hold'; end if;
 perform pg_advisory_xact_lock(hashtext('outline-hold:'||p_page_id::text));
 if exists(select 1 from public.exceptions e join public.actions x on x.id=e.action_id
   where e.status='open' and x.type='review_page' and x.target_id=p_page_id and x.input->>'source'='outline_review') then
   return jsonb_build_object('exceptions',0,'changeSetId',null);
 end if;
 submitted:=public.submit_change_set(null,'edit','ai','Outline review: '||page.title,p_trace,'[]');
 cs:=(submitted->>'changeSetId')::uuid;
 update public.change_sets set actor_attribution=jsonb_build_object('proposedBy',jsonb_build_object('role','reviewer','model',p_trace->>'modelVersion')) where id=cs;
 insert into public.actions(change_set_id,position,type,target_id,input,outcome)
 values(cs,0,'review_page',p_page_id,jsonb_build_object('operation','investigate','source','outline_review',
   'recommendation',left(p_finding->>'recommendation',2000),'reason',left(coalesce(p_finding->>'reason',''),2000),
   'guideline',left(coalesce(p_finding->>'guideline',''),4000),'quote','','destinationId',null,'pageSlug',page.slug,'pageTitle',page.title),'exception')
 returning id into a;
 insert into public.exceptions(action_id,reason,evidence) values(a,'domain_tree_review',jsonb_build_object('detail',left(coalesce(p_finding->>'reason',''),2000)));
 perform change_control.refresh_status(cs);
 return jsonb_build_object('exceptions',1,'changeSetId',cs);
end $$;
grant create on schema public to space_runtime;
alter function public.record_outline_hold(uuid,jsonb,jsonb) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke all on function public.record_outline_hold(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_outline_hold(uuid,jsonb,jsonb) to service_role,space_runtime;
notify pgrst,'reload schema';
