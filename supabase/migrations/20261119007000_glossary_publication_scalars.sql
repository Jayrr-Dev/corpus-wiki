-- OrioleDB can invalidate toasted fields retained in a whole-row PL/pgSQL
-- variable. Publication needs ownership plus two fields, not the review cache.
-- Copy each JSON field through text independently before later queries use it.
create or replace function public.publish_glossary_meanings(p_token uuid,p_hash text,p_entries jsonb,p_pending jsonb,p_registry jsonb,p_batches jsonb)
returns void language plpgsql security definer set search_path='' set jit=off as $$
declare owner_token uuid; owner_until timestamptz; generation_status text;
  overrides_text text; registry_text text; overrides jsonb; published jsonb;
begin
  select lease_token,lease_until,status into owner_token,owner_until,generation_status
    from public.glossary_state where id for update;
  if owner_token is distinct from p_token or owner_until<=clock_timestamp() or generation_status<>'generating' then
    raise exception 'Another glossary generation took over. Retry to see its result.';
  end if;
  if jsonb_typeof(p_entries)<>'array' or jsonb_typeof(p_pending)<>'array' or jsonb_typeof(p_registry)<>'object' then raise exception 'Invalid glossary publication.'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e where nullif(e->>'meaningId','') is null or jsonb_typeof(e->'usageNotes') is distinct from 'array') then
    raise exception 'Canonical meanings need stable identities and usage notes.';
  end if;
  select definition_overrides::text into overrides_text from public.glossary_state where id;
  select identity_registry::text into registry_text from public.glossary_state where id;
  overrides:=overrides_text::jsonb;
  select coalesce(jsonb_agg(case when overrides->(e->>'meaningId') ? 'definition'
    then e||jsonb_build_object('definition',overrides->(e->>'meaningId')->>'definition','personEdited',true) else e end),'[]')
    into published from jsonb_array_elements(p_entries) e
    where coalesce((overrides->(e->>'meaningId')->>'deleted')::boolean,false)=false;
  update public.glossary_state set entries=published,pending_entries=p_pending,identity_registry=registry_text::jsonb||p_registry,
    batches=p_batches,completed_batches=total_batches,input_hash=p_hash,generated_at=clock_timestamp(),status='ready',error=null,lease_token=null,lease_until=null where id;
end $$;
notify pgrst,'reload schema';
