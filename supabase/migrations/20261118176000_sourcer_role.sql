do $$
declare t text; c text; definition text; signature regprocedure;
begin
  for t,c in select * from (values ('ai_role_instructions','ai_role_instructions_role_check'),('ai_role_memory','ai_role_memory_role_check')) x(t,c) loop
    select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||t)::regclass and conname=c;
    execute format('alter table public.%I drop constraint %I',t,c);
    execute format('alter table public.%I add constraint %I %s',t,c,replace(definition,'''composer''','''composer'', ''sourcer'''));
  end loop;
  foreach signature in array array['public.set_ai_role_model(text,text)'::regprocedure,'public.set_ai_role_effort(text,text)'::regprocedure] loop
    definition:=pg_get_functiondef(signature);
    execute replace(definition,'''composer''','''composer'',''sourcer''');
  end loop;
end $$;
notify pgrst,'reload schema';
