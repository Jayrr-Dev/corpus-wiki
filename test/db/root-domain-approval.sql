-- Run inside a transaction and ROLLBACK. These checks never persist test data.
do $$
declare s uuid; x uuid; y uuid; r jsonb; root text:='Root approval verification '||gen_random_uuid();
begin
  r:=public.submit_change_set(null,'edit','ai','Root approval verification','{}',jsonb_build_array(
    jsonb_build_object('type','create_domain','input',jsonb_build_object('name',root,'path',root,'parentPath',null),'passageIds','[]'::jsonb),
    jsonb_build_object('type','create_domain','input',jsonb_build_object('name','Child','path',root||'/Child','parentPath',root),'passageIds','[]'::jsonb)));
  s:=(r->>'changeSetId')::uuid;
  perform public.commit_change_set(s);
  if exists(select 1 from public.domains where path=root) then raise exception 'Unapproved root was created'; end if;
  select ex.id into strict x from public.exceptions ex join public.actions a on a.id=ex.action_id
    where a.change_set_id=s and ex.reason::text='root_domain_approval';
  perform public.resolve_exception(x,true,null);
  if not exists(select 1 from public.domains where path=root||'/Child' and parent_id is not null) then
    raise exception 'Approval did not apply the dependent child'; end if;

  root:='Rejected root verification '||gen_random_uuid();
  r:=public.submit_change_set(null,'edit','ai','Rejection verification','{}',jsonb_build_array(
    jsonb_build_object('type','create_domain','input',jsonb_build_object('name',root,'path',root,'parentPath',null),'passageIds','[]'::jsonb),
    jsonb_build_object('type','create_domain','input',jsonb_build_object('name','Child','path',root||'/Child','parentPath',root),'passageIds','[]'::jsonb)));
  s:=(r->>'changeSetId')::uuid;
  perform public.commit_change_set(s);
  select ex.id into strict x from public.exceptions ex join public.actions a on a.id=ex.action_id where a.change_set_id=s;
  perform public.resolve_exception(x,false,null);
  if exists(select 1 from public.domains where path=root or starts_with(path,root||'/')) then
    raise exception 'Rejected root or dependent child was created'; end if;

  root:='Multiple roots verification '||gen_random_uuid();
  r:=public.submit_change_set(null,'edit','ai','Multiple root verification','{}',jsonb_build_array(
    jsonb_build_object('type','create_domain','input',jsonb_build_object('name',root,'path',root,'parentPath',null),'passageIds','[]'::jsonb),
    jsonb_build_object('type','create_domain','input',jsonb_build_object('name',root||' second','path',root||' second','parentPath',null),'passageIds','[]'::jsonb)));
  s:=(r->>'changeSetId')::uuid;
  perform public.commit_change_set(s);
  select ex.id into strict x from public.exceptions ex join public.actions a on a.id=ex.action_id where a.change_set_id=s and a.position=0;
  select ex.id into strict y from public.exceptions ex join public.actions a on a.id=ex.action_id where a.change_set_id=s and a.position=1;
  perform public.resolve_exception(x,true,null);
  if exists(select 1 from public.domains where path=root) then raise exception 'Applied before all decisions'; end if;
  perform public.resolve_exception(y,false,null);
  if not exists(select 1 from public.domains where path=root) or exists(select 1 from public.domains where path=root||' second') then
    raise exception 'Mixed root decisions were not respected'; end if;

  begin
    insert into public.domains(name,path,proposed_by) values('Bypass verification','Bypass verification '||gen_random_uuid(),'ai');
    raise exception 'Direct root insertion bypassed approval';
  exception when others then
    if sqlerrm not like 'AI root domains require approval%' then raise; end if;
  end;
end $$;
