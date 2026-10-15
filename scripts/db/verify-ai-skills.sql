-- Transactional integration checks: leaves the workspace unchanged.
begin;
do $test$
declare sample jsonb; saved jsonb; sample_skill_id uuid; rejected boolean:=false;
begin
  sample:=public.save_ai_skill(null,null,'Skill integration check '||gen_random_uuid()::text,'Test only','Keep exact thresholds.');
  sample_skill_id:=(sample->>'id')::uuid;
  saved:=public.save_ai_skill(sample_skill_id,1,sample->>'name','Test only','Keep thresholds and conditions.');
  if (saved->>'version')::integer<>2 then raise exception 'Version did not increment'; end if;
  begin perform public.save_ai_skill(sample_skill_id,1,sample->>'name','','Stale overwrite'); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Stale overwrite was accepted'; end if;
  perform public.assign_ai_stage_skill('write_articles',sample_skill_id);
  rejected:=false;
  begin perform public.archive_ai_skill(sample_skill_id,2,true); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Assigned skill could be archived'; end if;
  perform public.assign_ai_stage_skill('write_articles',null);
  perform public.archive_ai_skill(sample_skill_id,2,true);
  rejected:=false;
  begin perform public.assign_ai_stage_skill('write_articles',sample_skill_id); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Archived skill could be assigned'; end if;
  perform public.archive_ai_skill(sample_skill_id,3,false);
  perform public.assign_ai_stage_skill('write_articles',sample_skill_id);
  if not exists(select 1 from public.ai_stage_skills where stage='write_articles' and ai_stage_skills.skill_id=sample_skill_id) then raise exception 'Assignment not persisted'; end if;
  if (select count(*) from public.ai_skill_revisions r where r.skill_id=sample_skill_id)<>4 then raise exception 'Revision history missing'; end if;
  rejected:=false;
  begin perform public.save_ai_skill('a15c0000-0000-4000-8000-000000000007',1,'Changed default','','Replace default'); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Built-in could be changed'; end if;
  if has_function_privilege('authenticated','public.save_ai_skill(uuid,integer,text,text,text)','EXECUTE') then raise exception 'Mutation RPC exposed directly'; end if;
end;
$test$;
select 'Skill versions, conflicts, assignments, archive/restore, and access checks passed' as verification;
rollback;
