-- One definition can now be rewritten by the AI as well as by a person; the audit names who changed it.
drop function public.edit_glossary_definition(jsonb,text);
create function public.edit_glossary_definition(p_original jsonb,p_definition text default null,
  p_actor public.actor_kind default 'person',p_model text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare state public.glossary_state; next_entries jsonb; next_batches jsonb; cs uuid; snapshot jsonb;
begin
 if p_definition is not null and (length(btrim(p_definition))<1 or length(p_definition)>1000) then raise exception 'Enter a definition of up to 1,000 characters.'; end if;
 select * into state from public.glossary_state where id for update;
 if state.lease_until>now() then raise exception 'Wait for the glossary update to finish.'; end if;
 if not exists(select 1 from jsonb_array_elements(state.entries) e where e->>'term'=p_original->>'term' and e->>'scopeKey'=p_original->>'scopeKey' and e->>'definition'=p_original->>'definition') then
   raise exception 'This definition changed. Refresh and try again.';
 end if;
 select coalesce(jsonb_agg(case when e->>'term'=p_original->>'term' and e->>'scopeKey'=p_original->>'scopeKey' and e->>'definition'=p_original->>'definition'
   then e||jsonb_build_object('definition',btrim(p_definition)) else e end),'[]') into next_entries
 from jsonb_array_elements(state.entries) e
 where p_definition is not null or not(e->>'term'=p_original->>'term' and e->>'scopeKey'=p_original->>'scopeKey' and e->>'definition'=p_original->>'definition');
 select coalesce(jsonb_object_agg(key,items),'{}') into next_batches from (
   select b.key,coalesce((select jsonb_agg(case when e->>'term'=p_original->>'term' and e->>'scopeKey'=p_original->>'scopeKey' and e->>'definition'=p_original->>'definition'
     then e||jsonb_build_object('definition',btrim(p_definition)) else e end) from jsonb_array_elements(b.value) e
     where p_definition is not null or not(e->>'term'=p_original->>'term' and e->>'scopeKey'=p_original->>'scopeKey' and e->>'definition'=p_original->>'definition')),'[]') items
   from jsonb_each(state.batches) b) changed;
 -- The generated_at marker stays fixed; this single-definition change has its own atomic audit.
 update public.glossary_state set entries=next_entries,batches=next_batches,error=null,status='ready' where id;
 snapshot:=jsonb_build_object('entries',next_entries,'inputHash',state.input_hash,'generatedAt',state.generated_at);
 cs:=change_control.record_source_audit('glossary_update',null,
   jsonb_build_object('operation','Updated','title','Glossary','total',jsonb_array_length(next_entries),'added','[]'::jsonb,
     'revised',case when p_definition is null then '[]'::jsonb else jsonb_build_array(p_original->>'term') end,
     'removed',case when p_definition is null then jsonb_build_array(p_original->>'term') else '[]'::jsonb end,'snapshot',snapshot),
   jsonb_build_object('entries',state.entries,'inputHash',state.input_hash,'generatedAt',state.generated_at),
   'Updated glossary: '||case when p_definition is null then 'removed ' when p_actor='ai' then 'regenerated ' else 'edited ' end||'“'||(p_original->>'term')||'”',
   p_actor,p_model);
 return cs;
end $$;
revoke all on function public.edit_glossary_definition(jsonb,text,public.actor_kind,text) from public,anon,authenticated;
grant execute on function public.edit_glossary_definition(jsonb,text,public.actor_kind,text) to service_role;
notify pgrst,'reload schema';
