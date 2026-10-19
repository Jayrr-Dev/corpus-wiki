-- Reviewed definitions are durable and readable before the full review finishes.
alter table public.glossary_state add column live_entries jsonb not null default '[]' check(jsonb_typeof(live_entries)='array');
alter table public.glossary_state add column live_input_hash text;

grant create on schema public to space_runtime;
do $$ declare definition text; patched text; begin
 definition:=pg_get_functiondef('public.claim_glossary_generation(text,boolean)'::regprocedure);
 patched:=replace(definition,'generation_started_at=now(),',
   'live_entries=case when live_input_hash=p_hash then live_entries else ''[]''::jsonb end,live_input_hash=p_hash,generation_started_at=now(),');
 if patched=definition then raise exception 'Glossary claim changed; review live checkpoint initialization'; end if;
 execute patched;
end $$;
revoke create on schema public from space_runtime;

create function change_control.finish_glossary_live_entries() returns trigger
language plpgsql set search_path='' as $$ begin
 if new.status='ready' then new.live_entries:='[]'::jsonb; new.live_input_hash:=null; end if;
 return new;
end $$;
create trigger finish_glossary_live_entries before update on public.glossary_state
 for each row execute function change_control.finish_glossary_live_entries();
notify pgrst,'reload schema';
