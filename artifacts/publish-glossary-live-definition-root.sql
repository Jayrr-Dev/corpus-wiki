CREATE OR REPLACE FUNCTION public.publish_glossary_meanings(p_token uuid, p_hash text, p_entries jsonb, p_pending jsonb, p_registry jsonb, p_batches jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare state public.glossary_state; published jsonb;
begin
 select * into state from public.glossary_state where id for update;
 if state.lease_token is distinct from p_token or state.lease_until<=clock_timestamp() or state.status<>'generating' then
   raise exception 'Another glossary generation took over. Retry to see its result.';
 end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_typeof(p_pending)<>'array' or jsonb_typeof(p_registry)<>'object' then raise exception 'Invalid glossary publication.'; end if;
 if exists(select 1 from jsonb_array_elements(p_entries) e where nullif(e->>'meaningId','') is null or jsonb_typeof(e->'usageNotes') is distinct from 'array') then
   raise exception 'Canonical meanings need stable identities and usage notes.';
 end if;
 -- Manual definitions and deletions remain authoritative, even after an expired worker resumes.
 select coalesce(jsonb_agg(case when state.definition_overrides->(e->>'meaningId') ? 'definition'
   then e||jsonb_build_object('definition',state.definition_overrides->(e->>'meaningId')->>'definition','personEdited',true) else e end),'[]')
 into published from jsonb_array_elements(p_entries) e
 where coalesce((state.definition_overrides->(e->>'meaningId')->>'deleted')::boolean,false)=false;
 update public.glossary_state set entries=published,pending_entries=p_pending,identity_registry=state.identity_registry||p_registry,
   batches=p_batches,completed_batches=total_batches,input_hash=p_hash,generated_at=clock_timestamp(),status='ready',error=null,lease_token=null,lease_until=null where id;
end $function$
