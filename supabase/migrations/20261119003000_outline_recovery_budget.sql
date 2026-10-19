-- An outline attempt is a saved proposal, not completed work. Rejected
-- drafts/reviews must not reset the recovery budget indefinitely.
grant create on schema public to space_runtime;
do $$
declare definition text; patched text; signature text;
begin
  foreach signature in array array['public.claim_upload_recovery()', 'public.finish_upload_recovery(uuid,uuid,text)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    patched := replace(definition,
      'and key not like ''%:repair-v1:%''',
      'and key not like ''%:repair-v1:%'' and key not like ''outline-v1:%''');
    if patched = definition then raise exception 'Recovery progress query changed: %', signature; end if;
    if signature = 'public.finish_upload_recovery(uuid,uuid,text)' then
      definition := patched;
      patched := replace(definition,
        'attempts=case when progressed then 0 else attempts end',
        'attempts=case when p_error ~* ''Outline needs review after [0-9]+ attempts'' then 3 when progressed then 0 else attempts end');
      if patched = definition then raise exception 'Recovery budget update changed'; end if;
    end if;
    execute patched;
  end loop;
end $$;
revoke create on schema public from space_runtime;
notify pgrst, 'reload schema';
