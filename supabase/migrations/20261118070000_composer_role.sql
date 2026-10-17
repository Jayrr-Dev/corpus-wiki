-- Register Composer for editable instructions, model selection and role memory.
-- This enables the roster entry; it does not schedule live illustration work.
alter table public.ai_role_instructions drop constraint ai_role_instructions_role_check;
alter table public.ai_role_instructions add constraint ai_role_instructions_role_check check
  (role in ('extract_knowledge','identify_entities','link_knowledge','organize_topics','define_concepts','plan_articles','write_articles','researcher','reviewer','domain_steward','article_reviewer','curator','composer'));
alter table public.ai_role_memory drop constraint ai_role_memory_role_check;
alter table public.ai_role_memory add constraint ai_role_memory_role_check check
  (role in ('media_analyst','reconciler','deduplicator','identify_entities','link_knowledge','dictionary_editor','define_concepts','plan_articles','article_reviewer','write_articles','reviewer','researcher','domain_steward','curator','composer'));

-- Preserve each setter's existing validation, grants, search path and implementation.
do $$
declare signature regprocedure; definition text;
begin
  foreach signature in array array['public.set_ai_role_model(text,text)'::regprocedure, 'public.set_ai_role_effort(text,text)'::regprocedure]
  loop
    definition := pg_get_functiondef(signature);
    if position('''composer''' in definition) = 0 then
      if position('''curator''' in definition) = 0 then raise exception 'Role setter no longer has expected role list: %', signature; end if;
      execute replace(definition, '''curator''', '''curator'',''composer''');
    end if;
  end loop;
end $$;
