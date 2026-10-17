import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { pruneEmptySections } from "@/lib/living-page/pruneEmptySections";
import { revertChangeSet } from "@/lib/change-control";
import type { SectionRef } from "@/lib/living-page/types";

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store?.pg.close(); });

it("removes 17 empty sections in PostgreSQL, preserves existing text, and can undo the cleanup", async () => {
  const pageId = "00000000-0000-4000-8000-9a0000000001";
  const before = await store.db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
  const linesBefore = (await store.pg.query("select * from section_lines order by line_id")).rows;
  const inserted = await store.pg.query<{ id: string }>(`insert into sections (page_id,title,mode,query,position)
    select $1, 'Empty ' || n, 'generated', '{"unitIds":[]}', 100+n from generate_series(1,17) n returning id`, [pageId]);
  expect(await pruneEmptySections(store.db, inserted.rows.map((row) => row.id))).toBe(17);
  expect(await store.db.call("list_page_sections", { p_page_id: pageId })).toEqual(before);
  expect((await store.pg.query("select * from section_lines order by line_id")).rows).toEqual(linesBefore);
  const change = await store.pg.query<{ id: string }>("select id from change_sets where summary='Removed empty generated sections after article update'");
  await revertChangeSet(store.db, change.rows[0]!.id);
  const restored = await store.db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
  expect(restored).toHaveLength(before.length + 17);
});
