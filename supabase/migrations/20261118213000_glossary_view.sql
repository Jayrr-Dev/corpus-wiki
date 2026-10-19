-- Materialize each large JSON value separately. On the current storage engine,
-- projecting live_entries beside a review_cache expression can fail to detoast.
-- STABLE keeps all reads on the same snapshot; caller RLS remains in force.
create function public.read_glossary_view() returns jsonb
language plpgsql stable set search_path='' as $$
declare selected uuid:=public.current_space_id(); result jsonb; value jsonb;
begin
 select jsonb_build_object('status',status,'error',error,'generated_at',generated_at,
   'completed_batches',completed_batches,'total_batches',total_batches,'lease_until',lease_until)
 into result from public.glossary_state where space_id=selected and id;
 if result is null then return null; end if;
 select entries into value from public.glossary_state where space_id=selected and id;
 result:=result||jsonb_build_object('entries',value);
 select pending_entries into value from public.glossary_state where space_id=selected and id;
 result:=result||jsonb_build_object('pending_entries',value);
 select live_entries into value from public.glossary_state where space_id=selected and id;
 result:=result||jsonb_build_object('live_entries',value);
 select review_cache->'review_progress' into value from public.glossary_state where space_id=selected and id;
 return result||jsonb_build_object('review_progress',value);
end $$;
revoke all on function public.read_glossary_view() from public,anon;
grant execute on function public.read_glossary_view() to authenticated,service_role,space_runtime;
notify pgrst,'reload schema';
