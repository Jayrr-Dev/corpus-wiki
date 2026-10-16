-- Run inside a transaction and roll back: exercises real history and Undo.
do $$
declare s public.sources; cs uuid; rev uuid; decision_cs uuid; n integer;
begin
  select * into s from public.sources where origin='external' and archived_at is not null limit 1;
  if not found then raise exception 'Test requires an archived external source fixture.'; end if;
  perform public.set_source_archive(s.id,false,null);
  select a.change_set_id into cs from public.actions a where a.target_id=s.id and a.type::text='source_lifecycle' and a.outcome='applied' order by a.created_at desc,a.id limit 1;
  -- Transaction timestamps are shared, so select the exact restored state.
  select a.change_set_id into cs from public.actions a where a.target_id=s.id and a.type::text='source_lifecycle' and a.input->>'operation'='Restored' and a.outcome='applied' order by a.created_at desc limit 1;
  perform public.revert_change_set(cs);
  if (select archived_at from public.sources where id=s.id) is distinct from s.archived_at then raise exception 'Archive state was not restored'; end if;
  if (select status from public.change_sets where id=cs)<>'reverted' then raise exception 'Original history was not marked reverted'; end if;

  insert into public.external_source_reviews(source_id,stage,outcome,context,proposal,reason,url,source_title,excerpts,model)
    values(s.id,'source','approved','{"organization":"Audit test"}','{}','Test admission',s.url,s.title,array['test'],'test-model') returning id into rev;
  select change_set_id into decision_cs from public.actions where target_id=rev and type::text='source_review';
  perform public.set_source_archive(s.id,false,rev);
  perform public.revert_change_set(decision_cs);
  if (select reverted_at from public.external_source_reviews where id=rev) is null then raise exception 'Approval was not revoked'; end if;
  if (select archived_at from public.sources where id=s.id) is null then raise exception 'Revoked source remains active'; end if;
  begin
    perform public.set_source_archive(s.id,false,rev);
    raise exception 'Revoked review was reused';
  exception when others then
    if sqlerrm='Revoked review was reused' then raise; end if;
  end;
  select count(*) into n from public.actions where target_id=rev and type::text='source_review';
  if n<>2 then raise exception 'Reversal was not recorded'; end if;
  -- Undoing a prior state must not overwrite a later independent change.
  select a.change_set_id into cs from public.actions a where a.target_id=s.id and a.type::text='source_lifecycle' and a.input->>'operation'='Restored' and a.outcome='applied' order by a.created_at desc limit 1;
  begin
    perform public.revert_change_set(cs);
    raise exception 'Later source state was overwritten';
  exception when others then
    if sqlerrm='Later source state was overwritten' then raise; end if;
  end;
  select a.change_set_id into cs from public.actions a join public.change_sets c on c.id=a.change_set_id
    where a.target_id=rev and a.type::text='source_review' and a.outcome='applied' and c.proposed_by='person';
  perform public.revert_change_set(cs);
  if (select reverted_at from public.external_source_reviews where id=rev) is not null then raise exception 'Decision reversal could not itself be undone'; end if;
  if (select count(*) from public.actions where target_id=rev and type::text='source_review')<>3 then raise exception 'Reinstatement history missing'; end if;
end $$;
