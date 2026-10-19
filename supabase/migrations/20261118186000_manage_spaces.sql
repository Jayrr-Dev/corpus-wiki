-- Match the app's existing deletion model: retain history, but remove deleted
-- spaces and all their content from reads, writes, Realtime, and worker queues.
alter table public.spaces add column deleted_at timestamptz;
alter policy spaces_read on public.spaces using (owner_id=auth.uid() and deleted_at is null);
alter policy spaces_server on public.spaces using (
  owner_id=nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-person-id','')::uuid
  and deleted_at is null
);

create function public.space_management_person() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare person uuid := auth.uid(); begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role'='service_role' then
    person := nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-person-id','')::uuid;
  end if;
  if person is null then raise exception 'Not signed in' using errcode='42501'; end if;
  return person;
end $$;
revoke all on function public.space_management_person() from public,anon,authenticated;
grant execute on function public.space_management_person() to service_role,space_runtime;

create or replace function public.current_space_id() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  person uuid := auth.uid();
  selected uuid := nullif(h->>'x-space-id','')::uuid;
  result uuid;
begin
  if claims->>'role'='service_role' then person := nullif(h->>'x-person-id','')::uuid; end if;
  if person is null and (claims->>'role'='service_role' or claims='{}') then
    if selected is not null then
      select id into result from public.spaces where id=selected and deleted_at is null;
    else
      select s.id into result from public.spaces s
      where s.deleted_at is null and (s.id='00000000-0000-4000-8000-000000000001' or s.owner_id=(
        select owner_id from public.spaces where id='00000000-0000-4000-8000-000000000001'))
      order by (s.id='00000000-0000-4000-8000-000000000001') desc,s.created_at,s.id limit 1;
    end if;
  else
    if person is null then raise exception 'Not signed in' using errcode='42501'; end if;
    select s.id into result from public.spaces s
    where s.owner_id=person and s.deleted_at is null and (selected is null or s.id=selected)
    order by s.created_at,s.id limit 1;
  end if;
  if result is null then raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  return result;
end $$;

create or replace function public.readable_space_ids() returns uuid[]
language sql stable security definer set search_path='' as $$
  select case when nullif(current_setting('request.headers',true),'') is null
    then array(select id from public.spaces where owner_id=auth.uid() and deleted_at is null)
    else array[public.current_space_id()] end
$$;
create or replace function public.worker_spaces() returns setof uuid
language sql stable security definer set search_path='' as $$
  select id from public.spaces where deleted_at is null order by created_at,id
$$;

create or replace function public.ensure_my_space() returns jsonb
language plpgsql security definer set search_path='' as $$
declare person uuid := public.space_management_person(); s public.spaces; begin
  perform pg_advisory_xact_lock(hashtextextended(person::text,0));
  select * into s from public.spaces where owner_id=person and deleted_at is null order by created_at,id limit 1;
  if s.id is null then
    update public.spaces set owner_id=person where id='00000000-0000-4000-8000-000000000001' and owner_id is null and deleted_at is null returning * into s;
    if s.id is null then return public.create_space('My Space'); end if;
  end if;
  return to_jsonb(s);
end $$;

create function public.rename_space(p_id uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person uuid := public.space_management_person(); s public.spaces; begin
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Use a space name between 1 and 80 characters';
  end if;
  update public.spaces set name=btrim(p_name) where id=p_id and owner_id=person and deleted_at is null returning * into s;
  if s.id is null then raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  return to_jsonb(s);
end $$;

create function public.delete_space(p_id uuid,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare person uuid := public.space_management_person(); s public.spaces; replacement uuid; begin
  -- Serialize deletions for the owner so concurrent requests cannot delete both
  -- of their last two spaces. Lock the target against a concurrent rename too.
  perform pg_advisory_xact_lock(hashtextextended(person::text,0));
  select * into s from public.spaces where id=p_id and owner_id=person and deleted_at is null for update;
  if s.id is null then raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  if p_name is distinct from s.name then raise exception 'Type the space name exactly to confirm deletion'; end if;
  select id into replacement from public.spaces where owner_id=person and deleted_at is null and id<>p_id order by created_at,id limit 1;
  if replacement is null then raise exception 'Keep at least one space. Create another space before deleting this one.'; end if;
  update public.spaces set deleted_at=now() where id=p_id;
  return replacement;
end $$;
revoke all on function public.rename_space(uuid,text),public.delete_space(uuid,text) from public,anon,authenticated;
grant execute on function public.rename_space(uuid,text),public.delete_space(uuid,text) to service_role,space_runtime;
notify pgrst,'reload schema';
