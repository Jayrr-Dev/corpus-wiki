import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { RelatedSignals } from "@/lib/living-page/relatedArticles";

it("reads live claim centroids and connections, hides retired pages and handles missing vectors", async () => {
  const store = await portablePostgres();
  try {
    const root = "00000000-0000-4000-8000-9a0000000001";
    const other = "f0000000-0000-4000-8000-000000000001";
    await store.pg.query("insert into pages(id,title,slug) values($1,'Related','related-test')", [other]);
    await store.pg.query(`insert into sections(page_id,position,title,query)
      select $1,0,'Related',jsonb_build_object('unitIds',jsonb_agg(id::text)) from units where retired_at is null`, [other]);
    const vector = JSON.stringify([1, ...Array(1023).fill(0)]);
    await store.pg.query(`insert into unit_embeddings(revision_id,unit_id,model,embedding)
      select current_revision_id,id,'test',$1::extensions.vector from units where retired_at is null`, [vector]);
    const snapshot = await store.db.call<RelatedSignals & { pages: { id: string }[] }>("related_article_signals", { p_page_id: root });
    expect(snapshot.pages.some((p) => p.id === other)).toBe(true);
    expect(snapshot.similarities.find((p) => p.id === other)?.similarity).toBeCloseTo(1);
    expect(snapshot.connections.length).toBeGreaterThan(0);
    const permissions = await store.pg.query<{ allowed: boolean }>("select has_function_privilege('authenticated', 'public.related_article_signals(uuid)', 'execute') allowed");
    expect(permissions.rows[0]?.allowed).toBe(false);
    await store.pg.query("update pages set retired_at=now() where id=$1", [other]);
    const retired = await store.db.call<typeof snapshot>("related_article_signals", { p_page_id: root });
    expect(retired.pages.some((p) => p.id === other)).toBe(false);
    expect(retired.similarities.some((p) => p.id === other)).toBe(false);
    await store.pg.exec("delete from unit_embeddings");
    expect((await store.db.call<typeof snapshot>("related_article_signals", { p_page_id: root })).similarities).toEqual([]);
  } finally { await store.pg.close(); }
}, 60000);
