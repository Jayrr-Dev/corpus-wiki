-- A later text-patch dispatcher replaced the upload-topic allowlist/guard.
-- Restore that route without dropping text-patch support or the fast paths.
grant create on schema public to space_runtime;
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('public.upload_workflow_write(uuid,uuid,text,text,jsonb)'::regprocedure);
  patched:=replace(definition,
    '''submit_change_set'',''commit_change_set'',''commit_text_patch_set'',''complete_page_review''',
    '''submit_change_set'',''commit_change_set'',''commit_text_patch_set'',''commit_upload_topics'',''complete_page_review''');
  if patched=definition then raise exception 'Expected workflow allowlist changed'; end if;
  definition:=patched;
  patched:=replace(definition,
    'if p_function in (''commit_change_set'',''commit_text_patch_set'') then',
    'if p_function in (''commit_change_set'',''commit_text_patch_set'',''commit_upload_topics'') then');
  if patched=definition then raise exception 'Expected workflow ownership check changed'; end if;
  definition:=replace(patched,'if answer is null then',$replacement$
   if p_function='commit_upload_topics' and (p_args->>'p_event_id')::uuid is distinct from p_event_id then
     raise exception 'Domain assignments belong to another upload';
   end if;
   if answer is null then$replacement$);
  definition:=replace(definition,'elsif p_function=''submit_change_set'' then',$replacement$
   elsif p_function='commit_upload_topics' then
     answer:=public.commit_upload_topics((p_args->>'p_change_set_id')::uuid,(p_args->>'p_event_id')::uuid);
   elsif p_function='submit_change_set' then$replacement$);
  execute definition;
end $$;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
