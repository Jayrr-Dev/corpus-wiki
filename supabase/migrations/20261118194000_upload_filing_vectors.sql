-- Embedding similarity nominates already-filed neighbor claims. With no live
-- memberships there are no candidates, so serializing the whole book's vectors
-- only adds a large unused JSON payload to the filing context.
grant create on schema public to space_runtime;
do $$ declare definition text; patched text; begin
 definition:=pg_get_functiondef('public.upload_topic_context(uuid)'::regprocedure);
 patched:=replace(definition,
  'from public.unit_embeddings e join public.units u on u.current_revision_id=e.revision_id where u.retired_at is null)',
  'from public.unit_embeddings e join public.units u on u.current_revision_id=e.revision_id where u.retired_at is null
    and exists(select 1 from public.unit_domains m join public.domains d on d.id=m.domain_id
      join public.units neighbor on neighbor.id=m.unit_id where d.retired_at is null and neighbor.retired_at is null))');
 if patched=definition then raise exception 'Upload context vector query changed'; end if;
 execute patched;
end $$;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
