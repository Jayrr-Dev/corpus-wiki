-- GLOSSARY BY TOPIC: a glossary scope may name a topic (scope_id = domains.id), so a
-- study set, doc set or video can use only the glossary terms whose claims are in it.
-- Topic, article and entity scopes still need their id. The old checks were unnamed,
-- so they are found by their definition.
do $$
declare
  target record;
begin
  for target in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.study_sets'::regclass, 'public.doc_sets'::regclass, 'public.videos'::regclass)
      and pg_get_constraintdef(c.oid) like '%scope_kind = ''glossary''%scope_id IS NULL%'
  loop
    execute format('alter table %s drop constraint %I', target.tbl, target.conname);
  end loop;
end $$;

alter table public.study_sets add constraint study_sets_scope_id_check check (scope_kind = 'glossary' or scope_id is not null);
alter table public.doc_sets add constraint doc_sets_scope_id_check check (scope_kind = 'glossary' or scope_id is not null);
alter table public.videos add constraint videos_scope_id_check check (scope_kind = 'glossary' or scope_id is not null);
