-- Resolve the small set of cited revision IDs before reading revision rows.
-- An array join repeated for each line caused long saves on OrioleDB.
create or replace function change_control.refresh_section_cache(p_section_id uuid)
returns void language plpgsql set search_path='' as $$
begin
  update public.sections set body=coalesce((
    select string_agg(lr.content,' ' order by l.position,l.created_at)
    from public.lines l join public.line_revisions lr on lr.id=l.current_revision_id
    where l.section_id=p_section_id and l.retired_at is null),'')
  where id=p_section_id;
  delete from public.section_inputs where section_id=p_section_id;
  insert into public.section_inputs(section_id,unit_id,revision_id)
  with cited as materialized (
    select distinct unnest(lr.unit_revision_ids) id
    from public.lines l join public.line_revisions lr on lr.id=l.current_revision_id
    where l.section_id=p_section_id and l.retired_at is null
  )
  select distinct on(r.unit_id) p_section_id,r.unit_id,r.id
  from cited c join public.revisions r on r.id=c.id
  order by r.unit_id,r.created_at desc;
end $$;
