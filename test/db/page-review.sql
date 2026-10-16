begin;
do $$
declare p uuid; snap jsonb; proposal jsonb; result jsonb; ex uuid; cs uuid; bad boolean:=false;
begin
 select page_id into p from public.section_lines limit 1;
 if p is null then raise exception 'A populated page is required for this integration test'; end if;
 snap:=public.page_review_snapshot(p);
 proposal:=jsonb_build_object('summary','Test review','findings',jsonb_build_array(jsonb_build_object(
   'operation','investigate','quote',snap->'lines'->0->>'content','reason','Integration test',
   'guideline','Verifiability','recommendation','Check this evidence.','destinationId',null)));
 result:=public.record_page_review(p,snap,proposal,'{"modelVersion":"test"}');
 if result->>'exceptions'<>'1' then raise exception 'Expected one recommendation'; end if;
 if (public.record_page_review(p,snap,proposal,'{}')->>'exceptions')<>'0' then raise exception 'Duplicate recommendation was created'; end if;
 select e.id,a.change_set_id into ex,cs from public.exceptions e join public.actions a on a.id=e.action_id
 where a.type='review_page' and a.target_id=p and a.input->>'reason'='Integration test' and e.status='open';
 perform public.resolve_exception(ex,true,'Acknowledged');
 if (select status from public.exceptions where id=ex)<>'accepted' then raise exception 'Acknowledgement failed'; end if;
 if public.page_review_snapshot(p) is distinct from snap then raise exception 'Acknowledging changed article content'; end if;
 perform public.revert_change_set(cs);
 if public.page_review_snapshot(p) is distinct from snap then raise exception 'Undo changed article content'; end if;
 begin
   perform public.record_page_review(p,snap||'{"page":null}',proposal,'{}');
 exception when others then bad:=true; end;
 if not bad then raise exception 'Stale snapshot accepted'; end if;
 if has_function_privilege('authenticated','public.record_page_review(uuid,jsonb,jsonb,jsonb)','execute') then raise exception 'RPC exposed to clients'; end if;
end $$;
rollback;
