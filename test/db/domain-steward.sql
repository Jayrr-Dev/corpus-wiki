begin;
do $$
<<domain_steward>>
declare root_id uuid; a uuid; b uuid; snap jsonb; result jsonb; cs uuid; ex uuid; unit_id uuid;
begin
 insert into public.domains(name,path,proposed_by) values('Steward test','__steward_test__','person') returning id into root_id;
 insert into public.domains(name,path,parent_id,proposed_by) values('A','__steward_test__/A',root_id,'person') returning id into a;
 insert into public.domains(name,path,parent_id,proposed_by) values('B','__steward_test__/B',root_id,'person') returning id into b;
 select id into unit_id from public.units limit 1;
 if unit_id is not null then insert into public.unit_domains values(unit_id,a) on conflict do nothing; end if;
 snap:=public.domain_review_snapshot();
 result:=public.record_domain_review(snap,jsonb_build_object('operation','merge','domainId',a,'destinationId',b,'confident',true,'reason','Equivalent topics'),'{"modelVersion":"test","promptVersion":"test","tokensIn":1,"tokensOut":1}');
 cs:=(result->>'changeSetId')::uuid;
 if result->>'applied'<>'1' or not exists(select 1 from public.domains where id=a and retired_at is not null) then raise exception 'Merge not applied'; end if;
 if unit_id is not null and not exists(select 1 from public.unit_domains u where u.unit_id=domain_steward.unit_id and domain_id=b) then raise exception 'Claim lost its domain'; end if;
 perform public.revert_change_set(cs);
 if public.domain_review_snapshot() is distinct from snap then raise exception 'Undo did not restore exact structure'; end if;
 result:=public.record_domain_review(snap,jsonb_build_object('operation','rename','domainId',a,'name','Renamed','confident',false,'reason','Unsure about topic scope'),'{"modelVersion":"test"}');
 cs:=(result->>'changeSetId')::uuid;
 select id into ex from public.exceptions where action_id in(select id from public.actions where change_set_id=cs);
 if ex is null or (select name from public.domains where id=a)<>'A' then raise exception 'Uncertain action changed structure before approval'; end if;
 perform public.resolve_exception(ex,true,null);
 if (select name from public.domains where id=a)<>'Renamed' then raise exception 'Accepted proposal was not applied'; end if;
 update public.domains set name='Later change' where id=b;
 begin
   perform public.revert_change_set(cs);
   raise exception 'Unsafe undo was allowed';
 exception when others then
   if sqlerrm not like '%changed after this decision%' then raise; end if;
 end;
end $$;
rollback;
