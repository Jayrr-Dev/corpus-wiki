-- A glossary is created lazily in each space, including spaces that predate this fix.
create or replace function public.claim_glossary_generation(p_hash text,p_force boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid(); claimed uuid;
begin
 insert into public.glossary_state(space_id,id) values(public.current_space_id(),true)
 on conflict (space_id,id) do nothing;
 update public.glossary_state set lease_token=token,lease_until=now()+interval '10 minutes',
   generation_started_at=now(),status='generating',error=null,completed_batches=0
 where space_id=public.current_space_id() and id and (lease_until is null or lease_until<now())
   and (p_force or input_hash is distinct from p_hash or status<>'ready')
 returning lease_token into claimed;
 return claimed;
end $$;
alter function public.claim_glossary_generation(text,boolean) owner to space_runtime;
notify pgrst,'reload schema';
