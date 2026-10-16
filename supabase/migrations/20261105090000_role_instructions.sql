create table public.ai_role_instructions (
  role text primary key check (role in ('extract_knowledge','identify_entities','link_knowledge','organize_topics','define_concepts','plan_articles','write_articles','researcher','reviewer')),
  instructions text not null check (length(trim(instructions)) between 1 and 20000),
  version integer not null default 1
);
alter table public.ai_role_instructions enable row level security;

create function public.get_ai_role_instructions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from ai_role_instructions r;
$$;

create function public.save_ai_role_instructions(p_role text, p_instructions text, p_expected_version integer) returns void
language plpgsql security definer set search_path = public as $$
declare current_version integer;
begin
  perform pg_advisory_xact_lock(hashtext('ai_role_instructions:' || p_role));
  select version into current_version from ai_role_instructions where role = p_role;
  if current_version is distinct from p_expected_version then
    raise exception 'These instructions changed. Reload and try again.';
  end if;
  if p_instructions is null then
    delete from ai_role_instructions where role = p_role;
  else
    insert into ai_role_instructions(role, instructions, version) values (p_role, p_instructions, 1)
    on conflict (role) do update set instructions = excluded.instructions, version = ai_role_instructions.version + 1;
  end if;
end;
$$;
revoke all on public.ai_role_instructions from anon, authenticated;
revoke all on function public.get_ai_role_instructions() from public, anon, authenticated;
revoke all on function public.save_ai_role_instructions(text,text,integer) from public, anon, authenticated;
grant execute on function public.get_ai_role_instructions() to service_role;
grant execute on function public.save_ai_role_instructions(text,text,integer) to service_role;
