import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { ExploreResult, PublicationEditor, PublicWiki, WikiBody } from "@/lib/publishing/types";

describe("publishing a wiki with its sources", () => {
  let f: Awaited<ReturnType<typeof portablePostgres>>;
  const owner = "10000000-0000-4000-8000-000000000031";
  let sid: string, pageId: string, slug: string;
  const ids = { file: "40000000-0000-4000-8000-000000000001", web: "40000000-0000-4000-8000-000000000002", archived: "40000000-0000-4000-8000-000000000003", script: "40000000-0000-4000-8000-000000000004", unused: "40000000-0000-4000-8000-000000000005", login: "40000000-0000-4000-8000-000000000006" };

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
  const read = () => anonymous(() => f.db.call<PublicWiki | null>("read_public_wiki", { p_slug: slug, p_page: "garden", p_embed: false }));
  async function publish(sources?: boolean) {
    const e = await editor();
    return as(owner, sid, () => f.db.call<{ slug: string }>("publish_space_wiki", {
      p_visibility: "public", p_title: "Garden Wiki", p_description: "", p_publisher: "", p_embed: false,
      p_pages: e.pages.map(p => ({ id: p.id, fingerprint: p.fingerprint })), ...(sources === undefined ? {} : { p_sources: sources }),
    }));
  }

  beforeAll(async () => {
    f = await portablePostgres();
    await f.pg.query("insert into auth.users(id,email) values($1,'sources-owner@example.test')", [owner]);
    sid = (await as(owner, null, () => f.db.call<{ id: string }>("create_space", { p_name: "Garden" }))).id;
    await as(owner, sid, async () => {
      pageId = (await f.pg.query<{ id: string }>("insert into pages(title,slug) values('Garden','garden') returning id")).rows[0]!.id;
      const section = (await f.pg.query<{ id: string }>("insert into sections(page_id,position,title) values($1,0,'Growing') returning id", [pageId])).rows[0]!.id;
      const event = (await f.pg.query<{ id: string }>("insert into shift_events(cause,actor) values('edit','person') returning id")).rows[0]!.id;
      const add = (id: string, title: string, url: string | null, archived = false) => f.pg.query("insert into sources(id,title,mime_type,source_date,hash,storage_path,url,archived_at,archive_reason) values($1::uuid,$2,'application/pdf',now(),$1::text,$1::text,$3,$4,$5)", [id, title, url, archived ? new Date().toISOString() : null, archived ? 'Out of date' : null]);
      await add(ids.file, "Soil notes.pdf", null);
      await add(ids.web, "Seed guide", "https://seeds.example.test/guide?page=2");
      await add(ids.archived, "Old survey.pdf", null, true);
      await add(ids.script, "Odd link", "javascript:alert(1)");
      await add(ids.login, "Members area", "https://name:secret@example.test/area");
      await add(ids.unused, "Unused finances.xlsx", null);
      const passages = await Promise.all([ids.file, ids.web, ids.archived, ids.script, ids.login, ids.unused].map(async (id, i) => (await f.pg.query<{ id: string }>("insert into passages(source_id,position,text,hash) values($1::uuid,$2,'Private passage text',$1::text) returning id", [id, i])).rows[0]!.id));
      const unit = "50000000-0000-4000-8000-000000000001", revision = "50000000-0000-4000-8000-000000000002";
      await f.pg.query("insert into units(id,kind,epistemic_status,current_revision_id,valid_from) values($1,'fact','established',$2,now())", [unit, revision]);
      await f.pg.query("insert into revisions(id,unit_id,content,passage_ids,source_date,event_id,author) values($1,$2,'Radishes like deep soil.',$3,now(),$4,'ai')", [revision, unit, passages.slice(0, 5), event]);
      const line = "30000000-0000-4000-8000-000000000031", lineRevision = "30000000-0000-4000-8000-000000000032";
      await f.pg.query("insert into lines(id,section_id,position,current_revision_id) values($1,$2,0,$3)", [line, section, lineRevision]);
      await f.pg.query("insert into line_revisions(id,line_id,content,event_id,author,unit_revision_ids) values($1,$2,'Plant radishes in deep soil.',$3,'person',$4)", [lineRevision, line, event, [revision]]);
    });
  });
  afterAll(async () => { await f?.pg.close(); });

  it("publishes no source material unless asked, and tells the app the choice exists", async () => {
    slug = (await publish()).slug;
    const e = await editor();
    expect(e.publishChoices).toBe(true);
    expect(e.publication?.includeSources).toBe(false);
    const wiki = await read();
    expect(wiki?.page?.sources).toBeUndefined();
    for (const secret of ["Soil notes", "Seed guide", "seeds.example.test", "sources"]) expect(JSON.stringify(wiki)).not.toContain(secret);
  });

  it("lists only names and web links of the sources this page uses", async () => {
    await publish(true);
    expect((await editor()).publication?.includeSources).toBe(true);
    const wiki = await read();
    expect(wiki?.page?.sources).toEqual([
      { title: "Members area", url: null },
      { title: "Odd link", url: null },
      { title: "Seed guide", url: "https://seeds.example.test/guide?page=2" },
      { title: "Soil notes.pdf", url: null },
    ]);
    const serialized = JSON.stringify(wiki);
    for (const secret of ["Old survey", "Unused finances", "Private passage", "javascript:", "secret@", ...Object.values(ids), sid, owner]) expect(serialized).not.toContain(secret);
  });

  it("keeps the fingerprint on the article text and shows the owner the list in preview", async () => {
    const before = (await editor()).pages[0]!;
    const preview = await as(owner, sid, () => f.db.call<{ body: WikiBody; fingerprint: string; sources: unknown[] }>("preview_wiki_publication", { p_page: pageId }));
    expect(preview.fingerprint).toBe(before.fingerprint);
    expect(preview.body.sources).toBeUndefined();
    expect(preview.sources).toHaveLength(4);
  });

  it("does not make source names searchable", async () => {
    const found = await anonymous(() => f.db.call<ExploreResult>("explore_public_wikis", { p_query: "Soil notes" }));
    expect(found.total).toBe(0);
  });

  it("removes the list at the next publish with the choice off, and when made private", async () => {
    await publish(false);
    expect((await read())?.page?.sources).toBeUndefined();
    await publish(true);
    expect((await read())?.page?.sources).toHaveLength(4);
    await as(owner, sid, () => f.db.call("publish_space_wiki", { p_visibility: "private", p_title: "x", p_description: "", p_publisher: "", p_embed: false, p_pages: [] }));
    expect((await editor()).publication?.includeSources).toBe(false);
    expect(await read()).toBeNull();
  });

  it("gives public readers no way to call the source list directly", async () => {
    await expect(anonymous(() => f.db.call("wiki_publication_sources", { p_page: pageId, p_space: sid }))).rejects.toThrow();
  });
});
