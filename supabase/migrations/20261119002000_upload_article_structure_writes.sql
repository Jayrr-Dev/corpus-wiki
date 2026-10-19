-- Structure memory is part of an upload's article repair. Route these writes
-- through the same lease, cancellation and transactional replay protections.
grant create on schema public to space_runtime;
do $$ declare definition text; patched text;
begin
 definition := pg_get_functiondef('public.upload_workflow_write(uuid,uuid,text,text,jsonb)'::regprocedure);
 patched := replace(definition,
  '''complete_page_review'') then raise exception ''Unsupported workflow write''',
  '''complete_page_review'',''save_article_structure_plan'',''finish_article_structure_plan'') then raise exception ''Unsupported workflow write''');
 if patched = definition then raise exception 'Upload write allowlist changed; review structure dispatch'; end if;
 execute patched;
end $$;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
