-- Generated presentation over knowledge; authoritative claims stay in Change control.
create table public.glossary_state (
 id boolean primary key default true check (id),
 entries jsonb not null default '[]',
 batches jsonb not null default '{}',
 input_hash text,
 generated_at timestamptz,
 status text not null default 'idle' check (status in ('idle','generating','ready','error')),
 completed_batches integer not null default 0,
 total_batches integer not null default 0,
 error text,
 lease_token uuid,
 lease_until timestamptz
);
insert into public.glossary_state(id) values(true);
alter table public.glossary_state enable row level security;
grant select on public.glossary_state to authenticated;
grant all on public.glossary_state to service_role;
create policy glossary_read on public.glossary_state for select to authenticated using(true);

create function public.claim_glossary_generation(p_hash text, p_force boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid(); claimed uuid;
begin
 update public.glossary_state set lease_token=token,lease_until=now()+interval '10 minutes',
   status='generating',error=null,completed_batches=0
 where id and (lease_until is null or lease_until<now())
   and (p_force or input_hash is distinct from p_hash or status<>'ready')
 returning lease_token into claimed;
 return claimed;
end $$;
revoke all on function public.claim_glossary_generation(text,boolean) from public,anon,authenticated;
grant execute on function public.claim_glossary_generation(text,boolean) to service_role;
notify pgrst,'reload schema';
