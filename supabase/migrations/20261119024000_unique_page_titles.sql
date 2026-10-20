-- =====================================================================
-- ONE LIVE PAGE PER TITLE IN A SPACE (case and outer spaces ignored).
-- Two accepted suggestions created the same article twice. Existing
-- copies are merged: the oldest page keeps its slug and takes the other
-- copies' live sections (text and claims move with them), then the
-- copies are retired. New pages and renames onto a taken title are
-- rejected by the page check; the index is the last guard.
-- =====================================================================

do $$
declare
  v_keep record;
  v_copy record;
  v_next integer;
begin
  for v_keep in
    select distinct on (p.space_id, lower(btrim(p.title))) p.id, p.space_id, lower(btrim(p.title)) as key
    from public.pages p
    where p.retired_at is null
      and exists (
        select 1 from public.pages o
        where o.space_id = p.space_id and o.id <> p.id and o.retired_at is null
          and lower(btrim(o.title)) = lower(btrim(p.title)))
    order by p.space_id, lower(btrim(p.title)), p.created_at, p.id
  loop
    for v_copy in
      select p.id from public.pages p
      where p.space_id = v_keep.space_id and p.id <> v_keep.id and p.retired_at is null
        and lower(btrim(p.title)) = v_keep.key
      order by p.created_at, p.id
    loop
      select coalesce(max(position), -1) + 1 into v_next
      from public.sections where page_id = v_keep.id and retired_at is null;
      update public.sections s
      set page_id = v_keep.id, position = v_next + moved.rank
      from (
        select id, (row_number() over (order by position, created_at) - 1)::integer as rank
        from public.sections where page_id = v_copy.id and retired_at is null
      ) moved
      where s.id = moved.id;
      update public.pages set parent_page_id = v_keep.id where parent_page_id = v_copy.id;
      update public.pages set retired_at = now() where id = v_copy.id;
    end loop;
  end loop;
end $$;

create unique index pages_live_title on public.pages (space_id, lower(btrim(title))) where retired_at is null;

-- CHECK: a new or renamed page may not take another live page's title
alter function change_control.check_page(public.actions, public.actor_kind) rename to check_page_before_unique_title;
create function change_control.check_page(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_title text := lower(btrim(coalesce(p_action.input ->> 'title', '')));
  v_taken text;
begin
  if p_action.type::text in ('create_page', 'rename_page') and v_title <> '' then
    select title into v_taken from public.pages
    where space_id = public.current_space_id() and retired_at is null
      and lower(btrim(title)) = v_title
      and id is distinct from case when p_action.type::text = 'rename_page' then p_action.target_id end
    limit 1;
    if v_taken is not null then
      return change_control.check('page', false, format('A page called “%s” already exists.', v_taken));
    end if;
  end if;
  return change_control.check_page_before_unique_title(p_action, p_proposed_by);
end $$;

revoke all on function change_control.check_page(public.actions, public.actor_kind),
  change_control.check_page_before_unique_title(public.actions, public.actor_kind) from public, anon, authenticated;
grant execute on function change_control.check_page(public.actions, public.actor_kind),
  change_control.check_page_before_unique_title(public.actions, public.actor_kind) to service_role, space_runtime;
grant create on schema change_control to space_runtime;
alter function change_control.check_page(public.actions, public.actor_kind) owner to space_runtime;
revoke create on schema change_control from space_runtime;
notify pgrst, 'reload schema';
