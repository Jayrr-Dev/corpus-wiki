-- Empty scaffolding is unfinished even if its evidence selection is empty.
-- Sections whose actual content is an illustration remain valid.
create or replace function public.guard_empty_section_completion() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.mode='generated' and new.status='current' and new.retired_at is null
   and not exists(select 1 from public.section_lines l where l.section_id=new.id and length(trim(l.content))>0)
   and not public.composer_section_has_images(new.id) then
   new.status:='stale';
   new.built_at:=null;
   new.building_since:=null;
 end if;
 return new;
end $$;
update public.sections set status='current'
 where mode='generated' and status='current' and retired_at is null
 and not exists(select 1 from public.section_lines l where l.section_id=sections.id and length(trim(l.content))>0)
 and not public.composer_section_has_images(id);
