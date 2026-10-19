-- Repair notes preserve a rejected proposal, not completed processing. Counting
-- them as progress would keep resetting the automatic retry budget forever.
grant create on schema public to space_runtime;
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('public.claim_upload_recovery()'::regprocedure);
  patched:=replace(definition,
    'where event_id=j.event_id and state=''succeeded''',
    'where event_id=j.event_id and state=''succeeded'' and key not like ''%:repair-v1:%''');
  if patched=definition then raise exception 'Recovery claim progress query changed'; end if;
  execute patched;
  definition:=pg_get_functiondef('public.finish_upload_recovery(uuid,uuid,text)'::regprocedure);
  patched:=replace(definition,
    'where event_id=p_event_id and state=''succeeded''',
    'where event_id=p_event_id and state=''succeeded'' and key not like ''%:repair-v1:%''');
  if patched=definition then raise exception 'Recovery completion progress query changed'; end if;
  execute patched;
end $$;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
