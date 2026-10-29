import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

// The wiki's page reads that must skip Docs pages (supabase/migrations/20261121010000_docs_out_of_wiki_reads.sql)
const ARTICLE_ONLY = [
  "article_topic_links(uuid)", "curator_snapshot()", "domain_review_snapshot()", "page_candidates(uuid)", "page_review_related(uuid[])",
  "pages_needing_editorial_review(uuid[])", "related_article_signals(uuid)", "wiki_publication_editor()", "wiki_publication_snapshot(uuid,uuid)",
];
// Reads that keep seeing Docs pages, so their sections still rebuild
const EVERY_KIND = ["list_affected_sections(uuid)", "read_section_units(uuid)"];

it("keeps Docs pages out of the wiki's page reads and nowhere else", async () => {
  const { pg } = await portablePostgres();
  try {
    const definition = async (fn: string) => (await pg.query<{ def: string }>(`select pg_get_functiondef('public.${fn}'::regprocedure) def`)).rows[0]!.def;
    for (const fn of ARTICLE_ONLY) expect(await definition(fn), fn).toMatch(/kind = 'article'/);
    for (const fn of EVERY_KIND) expect(await definition(fn), fn).not.toMatch(/kind = 'article'/);
    // owners and grants survive the rewrite
    const grants = await pg.query<{ fn: string; owner: string; anon: boolean }>(`select p.proname fn, pg_get_userbyid(p.proowner) owner,
      has_function_privilege('anon', p.oid, 'execute') anon from pg_proc p where p.oid = 'public.wiki_publication_editor()'::regprocedure`);
    expect(grants.rows[0]).toMatchObject({ anon: false });
  } finally { await pg.close(); }
}, 120_000);
