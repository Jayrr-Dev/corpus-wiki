import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { PublicationEditor, PublicWiki, ExploreResult, WikiMetrics } from "@/lib/publishing/types";

describe("published spaces and anonymous readers", () => {
  let f: Awaited<ReturnType<typeof portablePostgres>>;
  const owner = "10000000-0000-4000-8000-000000000011";
  const other = "10000000-0000-4000-8000-000000000012";
  let sid: string, otherSid: string, pageId: string, hiddenId: string, slug: string;
  const hash = "a".repeat(64), rate = "b".repeat(64);

  async function as<T>(person: string | null, space: string | null, run: () => Promise<T>, role = "service_role"): Promise<T> {
    await f.pg.exec("begin");
    try {
      await f.pg.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role',$3,true),set_config('request.headers',$4,true)", [JSON.stringify({ role }), "", role, JSON.stringify({ ...(person ? { "x-person-id": person } : {}), ...(space ? { "x-space-id": space } : {}) })]);
      await f.pg.exec(`set local role ${role}; select public.scope_space_request()`);
      const result = await run(); await f.pg.exec("commit"); return result;
    } catch (error) { await f.pg.exec("rollback"); throw error; }
  }
  const anonymous = <T>(run: () => Promise<T>) => as(null, null, run, "anon");
  const editor = () => as(owner, sid, () => f.db.call<PublicationEditor>("wiki_publication_editor"));
  const read = (embed = false) => anonymous(() => f.db.call<PublicWiki | null>("read_public_wiki", { p_slug: slug, p_page: "garden", p_embed: embed }));
  async function publish(visibility = "public", embed = true) {
    const e = await editor();
    return as(owner, sid, () => f.db.call<{ slug: string }>("publish_space_wiki", {
      p_visibility: visibility, p_title: "Garden Wiki", p_description: "Growing together", p_publisher: "Gardeners", p_embed: embed,
      p_pages: e.pages.filter(p => p.id === pageId).map(p => ({ id: p.id, fingerprint: p.fingerprint })),
    }));
  }
  beforeAll(async () => {
    f = await portablePostgres();
    await f.pg.query("insert into auth.users(id,email) values($1,'publisher@example.test'),($2,'reader@example.test')", [owner, other]);
    sid = (await as(owner, null, () => f.db.call<{ id: string }>("create_space", { p_name: "Garden" }))).id;
    otherSid = (await as(other, null, () => f.db.call<{ id: string }>("create_space", { p_name: "Other" }))).id;
    await as(owner, sid, async () => {
      pageId = (await f.pg.query<{ id: string }>("insert into pages(title,slug) values('Garden','garden') returning id")).rows[0]!.id;
      hiddenId = (await f.pg.query<{ id: string }>("insert into pages(title,slug) values('Private finances','secret-finances') returning id")).rows[0]!.id;
      const section = (await f.pg.query<{ id: string }>("insert into sections(page_id,position,title) values($1,0,'Growing') returning id", [pageId])).rows[0]!.id;
      const event = (await f.pg.query<{ id: string }>("insert into shift_events(cause,actor) values('edit','person') returning id")).rows[0]!.id;
      const line = "30000000-0000-4000-8000-000000000011", revision = "30000000-0000-4000-8000-000000000012";
      await f.pg.query("insert into lines(id,section_id,position,current_revision_id) values($1,$2,0,$3)", [line, section, revision]);
      await f.pg.query("insert into line_revisions(id,line_id,content,event_id,author) values($1,$2,'Plant winter radishes in deep soil.',$3,'person')", [revision, line, event]);
    });
  });
  afterAll(async () => { await f?.pg.close(); });

  it("publishes only selected article text and discovers matches in article bodies", async () => {
    slug = (await publish()).slug;
    expect(slug).toMatch(/^[a-f0-9]{32}$/);
    const wiki = await read();
    expect(wiki?.page?.sections[0]?.lines).toEqual(["Plant winter radishes in deep soil."]);
    expect(wiki?.pages).toEqual([{ slug: "garden", title: "Garden" }]);
    const serialized = JSON.stringify(wiki);
    for (const secret of [owner, sid, pageId, hiddenId, "secret-finances", "space_id", "event_id", "unit_revision_ids"]) expect(serialized).not.toContain(secret);
    const results = await anonymous(() => f.db.call<ExploreResult>("explore_public_wikis", { p_query: "radishes" }));
    expect(results.total).toBe(1);
    expect(results.spaces[0]?.matching_pages).toEqual([{ slug: "garden", title: "Garden" }]);
    const hidden = await anonymous(() => f.db.call<ExploreResult>("explore_public_wikis", { p_query: "secret-finances" }));
    expect(hidden.total).toBe(0);
  });

  it("keeps drafts private, detects stale previews, and rolls back a failed edition", async () => {
    const e = await editor();
    await as(owner, sid, () => f.pg.query("update line_revisions set content='DRAFT SECRET' where content='Plant winter radishes in deep soil.'"));
    expect(JSON.stringify(await read())).not.toContain("DRAFT SECRET");
    await expect(as(owner, sid, () => f.db.call("publish_space_wiki", {
      p_visibility: "public", p_title: "Changed", p_description: "", p_publisher: "", p_embed: true,
      p_pages: e.pages.filter(p => p.id === pageId).map(p => ({ id: p.id, fingerprint: p.fingerprint })),
    }))).rejects.toThrow(/changed/);
    expect((await read())?.title).toBe("Garden Wiki");
  });

  it("keeps unlisted content out of all Explore searches and disables embeds independently", async () => {
    await publish("unlisted", false);
    expect(await read()).not.toBeNull();
    expect(await read(true)).toBeNull();
    for (const query of ["", "Garden", "DRAFT SECRET", slug]) {
      expect((await anonymous(() => f.db.call<ExploreResult>("explore_public_wikis", { p_query: query }))).total).toBe(0);
    }
    await publish();
  });

  it("rejects anonymous workspace access, writes, helper calls and owner metrics", async () => {
    for (const table of ["pages", "sections", "line_revisions", "space_publications", "published_wiki_pages", "public_wiki_events"]) {
      await expect(anonymous(() => f.pg.query(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
    }
    await expect(anonymous(() => f.db.call("wiki_publication_editor"))).rejects.toThrow(/permission denied/);
    await expect(anonymous(() => f.db.call("wiki_publication_snapshot", { p_page: pageId, p_space: sid }))).rejects.toThrow(/permission denied/);
    await expect(anonymous(() => f.db.call("public_wiki_metrics"))).rejects.toThrow(/permission denied/);
    await expect(anonymous(() => f.db.call("record_public_wiki_event", { p_slug: slug, p_page: "garden", p_edition: ({} as PublicWiki).edition, p_visitor: hash, p_rate: rate, p_surface: "site", p_channel: "direct", p_kind: "view" }))).rejects.toThrow(/permission denied/);
    await expect(as(other, sid, () => f.db.call("wiki_publication_editor"))).rejects.toThrow(/not owned/);
    await expect(as(other, otherSid, () => f.db.call("preview_wiki_publication", { p_page: pageId }))).rejects.toThrow(/not found/i);
  });

  it("rejects cross-space publication and keeps another owner's metrics isolated", async () => {
    const e = await editor();
    await expect(as(other, otherSid, () => f.db.call("publish_space_wiki", {
      p_visibility: "public", p_title: "Stolen", p_description: "", p_publisher: "", p_embed: true,
      p_pages: e.pages.filter(p => p.id === pageId).map(p => ({ id: p.id, fingerprint: p.fingerprint })),
    }))).rejects.toThrow(/another space/);
    expect((await as(other, otherSid, () => f.db.call<WikiMetrics>("public_wiki_metrics"))).views).toBe(0);
  });

  it("deduplicates metrics, excludes owners, and rejects old-edition or unpublished-page events", async () => {
    const wiki = (await read())!;
    const event = (person: string | null, kind = "view", edition = wiki.edition, page = "garden", surface = "site") => as(person, null, () => f.db.call("record_public_wiki_event", {
      p_slug: slug, p_page: page, p_edition: edition, p_visitor: hash, p_rate: rate, p_surface: surface, p_channel: "direct", p_kind: kind,
    }));
    await event(owner); await event(null); await event(null); await event(null, "engaged");
    await event(null, "view", wiki.edition, "secret-finances");
    await event(null, "view", "00000000-0000-4000-8000-000000000000");
    const metrics = await as(owner, sid, () => f.db.call<WikiMetrics>("public_wiki_metrics"));
    expect(metrics).toMatchObject({ views: 1, sessions: 1, engagedReads: 1, embedViews: 0 });
    expect(metrics.topPages[0]?.views).toBe(1);
    expect(JSON.stringify(metrics)).not.toContain(hash);
    await publish("private");
    expect(await read()).toBeNull(); expect(await read(true)).toBeNull();
    expect((await anonymous(() => f.db.call<ExploreResult>("explore_public_wikis"))).total).toBe(0);
    await event(null, "view", wiki.edition, "garden", "embed");
    expect((await as(owner, sid, () => f.db.call<WikiMetrics>("public_wiki_metrics"))).views).toBe(1);
  });

  it("withdraws deleted spaces even if a publication remains", async () => {
    await publish();
    await f.pg.query("update public.spaces set deleted_at=now() where id=$1", [sid]);
    expect(await read()).toBeNull();
    expect((await anonymous(() => f.db.call<ExploreResult>("explore_public_wikis"))).total).toBe(0);
  });
});
