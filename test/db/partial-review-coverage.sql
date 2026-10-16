-- Run inside a transaction; the caller rolls back the review rows.
do $$
declare p uuid; snap jsonb; marker text := 'coverage-test-'||gen_random_uuid()::text; saved_hash text;
begin
 select page_id into p from public.section_lines limit 1;
 if p is null then raise exception 'A populated page is required'; end if;
 snap := public.page_review_snapshot(p);
 perform public.complete_page_review(p,snap,jsonb_build_object('summary',marker||'-partial','findings','[]'::jsonb,'coverageComplete',false),'[]','{}');
 select snapshot_hash into saved_hash from public.page_review_runs where summary=marker||'-partial';
 if saved_hash is distinct from 'partial:'||public.page_review_content_hash(p) then raise exception 'Partial review was cached as complete'; end if;
 perform public.complete_page_review(p,snap,jsonb_build_object('summary',marker||'-complete','findings','[]'::jsonb,'coverageComplete',true),'[]','{}');
 select snapshot_hash into saved_hash from public.page_review_runs where summary=marker||'-complete';
 if saved_hash is distinct from public.page_review_content_hash(p) then raise exception 'Complete review was not cached'; end if;
 if public.page_review_snapshot(p) is distinct from snap then raise exception 'Coverage recording modified article evidence'; end if;
end $$;
