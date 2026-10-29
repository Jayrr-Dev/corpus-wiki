-- =====================================================================
-- SECOND BRAIN · DOCS PAGES STAY OUT OF THE WIKI'S READS
-- =====================================================================
-- A Docs page (pages.kind = 'doc', docs/knowledge-modules-plan.md) is read
-- in the Docs module. The functions below list pages for the wiki, its AI
-- planning and its public publication, and they now see articles only:
--   article_topic_links, related_article_signals  links between articles
--   curator_snapshot, domain_review_snapshot,      what the curator, domain
--   page_candidates, page_review_related            review, suggestions and
--   pages_needing_editorial_review                  page review work on
--   wiki_publication_editor, wiki_publication_snapshot  a published wiki
-- Functions that rebuild or read a section by id (list_affected_sections,
-- read_section_units, ...) still see doc pages, so Docs stay current.
--
-- Each function is rewritten from its live definition by replacing one
-- clause, the same way 20261121000000 extends the role lists; a clause that
-- is not found exactly once stops the migration instead of being skipped.
-- CREATE OR REPLACE keeps each function's owner and grants.
-- =====================================================================

grant create on schema public to space_runtime;

do $$
declare
  edit record;
  definition text;
  changed text;
begin
  for edit in select * from (values
    ('public.article_topic_links(uuid)'::regprocedure,
      E'join public.pages p on p.id <> root.id\n    and p.retired_at is null',
      E'join public.pages p on p.id <> root.id\n    and p.retired_at is null and p.kind = ''article'''),
    ('public.curator_snapshot()'::regprocedure,
      'live_pages as (select * from public.pages where retired_at is null)',
      'live_pages as (select * from public.pages where retired_at is null and kind = ''article'')'),
    ('public.domain_review_snapshot()'::regprocedure,
      '''domain_id'',domain_id) order by id) from public.pages)',
      '''domain_id'',domain_id) order by id) from public.pages where kind = ''article'')'),
    ('public.page_candidates(uuid)'::regprocedure,
      'where p.entity_id = ec.id and p.retired_at is null',
      'where p.entity_id = ec.id and p.retired_at is null and p.kind = ''article'''),
    ('public.page_review_related(uuid[])'::regprocedure,
      'public.pages p where p.retired_at is null and p.id in (',
      'public.pages p where p.retired_at is null and p.kind = ''article'' and p.id in ('),
    ('public.pages_needing_editorial_review(uuid[])'::regprocedure,
      'where p.space_id=public.current_space_id() and p.retired_at is null',
      'where p.space_id=public.current_space_id() and p.retired_at is null and p.kind = ''article'''),
    ('public.related_article_signals(uuid)'::regprocedure,
      E'join public.pages root on root.id = p_page_id and root.retired_at is null\n  where p.retired_at is null',
      E'join public.pages root on root.id = p_page_id and root.retired_at is null\n  where p.retired_at is null and p.kind = ''article'''),
    ('public.wiki_publication_editor()'::regprocedure,
      'from public.pages p where p.space_id=sid and p.retired_at is null)',
      'from public.pages p where p.space_id=sid and p.retired_at is null and p.kind = ''article'')'),
    ('public.wiki_publication_snapshot(uuid,uuid)'::regprocedure,
      'from public.pages p where p.id=p_page and p.space_id=p_space and p.retired_at is null',
      'from public.pages p where p.id=p_page and p.space_id=p_space and p.retired_at is null and p.kind = ''article''')
  ) as e(fn, clause, replacement)
  loop
    definition := replace(pg_get_functiondef(edit.fn), E'\r\n', E'\n');
    if (length(definition) - length(replace(definition, edit.clause, ''))) / length(edit.clause) <> 1 then
      raise exception 'docs_out_of_wiki_reads: % does not contain its clause exactly once', edit.fn;
    end if;
    changed := replace(definition, edit.clause, edit.replacement);
    execute changed;
  end loop;
end $$;

revoke create on schema public from space_runtime;

notify pgrst, 'reload schema';
