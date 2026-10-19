-- These hot paths have fixed, known signatures. Avoid repeatedly planning a
-- catalog lookup and dynamic record conversion for every saved book batch.
-- Lease checks, operation keys, attribution and change control remain unchanged.
grant create on schema public to space_runtime;
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('public.upload_workflow_write(uuid,uuid,text,text,jsonb)'::regprocedure);
  patched:=replace(definition,
    'select p.* into strict proc from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace',
    $replacement$if p_function='commit_change_set' then
     answer:=public.commit_change_set((p_args->>'p_change_set_id')::uuid);
   elsif p_function='submit_change_set' then
     answer:=public.submit_change_set((p_args->>'p_event_id')::uuid,(p_args->>'p_cause')::public.event_cause,
       (p_args->>'p_actor')::public.actor_kind,p_args->>'p_summary',p_args->'p_trace',p_args->'p_actions');
   else
   select p.* into strict proc from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace$replacement$);
  if patched=definition then raise exception 'Upload dispatcher changed; review optimization'; end if;
  definition:=patched;
  patched:=replace(definition,
    'into answer using p_args;', 'into answer using p_args; end if;');
  if patched=definition then raise exception 'Upload dispatch result changed; review optimization'; end if;
  execute patched;
end $$;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
