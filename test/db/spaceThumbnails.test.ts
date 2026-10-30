import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { ExploreResult, PublicationEditor, ThumbnailState } from "@/lib/publishing/types";

describe("space thumbnails", () => {
  let f: Awaited<ReturnType<typeof portablePostgres>>;
  const owner = "10000000-0000-4000-8000-000000000021";
  const other = "10000000-0000-4000-8000-000000000022";
  let sid: string, otherSid: string, slug: string, path: string;

  async function as<T>(person: string | null, space: string | null, run: () => Promise<T>, role = "service_role"): Promise<T> {
    await f.pg.exec("begin");
    try {
      await f.pg.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role',$3,true),set_config('request.headers',$4,true)", [JSON.stringify({ role }), "", role, JSON.stringify({ ...(person ? { "x-person-id": person } : {}), ...(space ? { "x-space-id": space } : {}) })]);
      await f.pg.exec(`set local role ${role}; select public.scope_space_request()`);
      const result = await run(); await f.pg.exec("commit"); return result;
    } catch (error) { await f.pg.exec("rollback"); throw error; }
  }
  const anonymous = <T>(run: () => Promise<T>) => as(null, null, run, "anon");
  const set = (p: string | null, auto = false) => as(owner, sid, () => f.db.call<string | null>("set_space_thumbnail", { p_path: p, p_auto: auto }));
  const state = () => as(owner, sid, () => f.db.call<ThumbnailState | null>("space_thumbnail_state"));
  const publicPath = () => anonymous(() => f.db.call<string | null>("public_wiki_thumbnail", { p_slug: slug }));
  const explore = () => anonymous(() => f.db.call<ExploreResult>("explore_public_wikis"));
  async function publish(visibility: string, pageId: string) {
    const editor = await as(owner, sid, () => f.db.call<PublicationEditor>("wiki_publication_editor"));
    return as(owner, sid, () => f.db.call<{ slug: string }>("publish_space_wiki", {
      p_visibility: visibility, p_title: "Garden Wiki", p_description: "", p_publisher: "", p_embed: false,
      p_pages: visibility === "private" ? [] : editor.pages.filter(p => p.id === pageId).map(p => ({ id: p.id, fingerprint: p.fingerprint })),
    }));
  }
  let pageId: string;

  beforeAll(async () => {
    f = await portablePostgres();
    await f.pg.query("insert into auth.users(id,email) values($1,'thumb-owner@example.test'),($2,'thumb-other@example.test')", [owner, other]);
    sid = (await as(owner, null, () => f.db.call<{ id: string }>("create_space", { p_name: "Garden" }))).id;
    otherSid = (await as(other, null, () => f.db.call<{ id: string }>("create_space", { p_name: "Other" }))).id;
    await as(owner, sid, async () => {
      pageId = (await f.pg.query<{ id: string }>("insert into pages(title,slug) values('Garden','garden') returning id")).rows[0]!.id;
      const section = (await f.pg.query<{ id: string }>("insert into sections(page_id,position,title) values($1,0,'Growing') returning id", [pageId])).rows[0]!.id;
      const event = (await f.pg.query<{ id: string }>("insert into shift_events(cause,actor) values('edit','person') returning id")).rows[0]!.id;
      const line = "30000000-0000-4000-8000-000000000021", revision = "30000000-0000-4000-8000-000000000022";
      await f.pg.query("insert into lines(id,section_id,position,current_revision_id) values($1,$2,0,$3)", [line, section, revision]);
      await f.pg.query("insert into line_revisions(id,line_id,content,event_id,author) values($1,$2,'Plant radishes.',$3,'person')", [revision, line, event]);
    });
  });
  afterAll(async () => { await f?.pg.close(); });

  it("needs a live publication first", async () => {
    await expect(set(`${"a".repeat(32)}/${"b".repeat(64)}.webp`)).rejects.toThrow("Publish this space");
    expect(await state()).toBeNull();
  });

  it("starts undecided, then serves readers a version and never the path", async () => {
    slug = (await publish("public", pageId)).slug;
    path = `${slug}/${"b".repeat(64)}.webp`;
    expect(await state()).toMatchObject({ slug, path: null, version: null, auto: true });
    expect((await explore()).spaces[0]!.thumbnail_version).toBeNull();
    await set(path, true);
    const listed = await explore();
    expect(listed.spaces[0]!.thumbnail_version).toMatch(/^[a-f0-9]{12}$/);
    expect(JSON.stringify(listed)).not.toContain("b".repeat(64));
    expect(await publicPath()).toBe(path);
  });

  it("keeps a person's choice to have no thumbnail", async () => {
    expect(await set(null, false)).toBe(path);
    expect(await state()).toMatchObject({ path: null, auto: false });
    await set(path, false);
  });

  it("refuses a path from another Space and a malformed one", async () => {
    await expect(set(`${"c".repeat(32)}/${"b".repeat(64)}.webp`)).rejects.toThrow("another space");
    await expect(set(`${slug}/../../secret.png`)).rejects.toThrow();
  });

  it("keeps thumbnails from other people and anonymous callers", async () => {
    await expect(as(other, otherSid, () => f.db.call("set_space_thumbnail", { p_path: null, p_auto: false }))).rejects.toThrow("Publish this space");
    await expect(as(other, sid, () => f.db.call("set_space_thumbnail", { p_path: null, p_auto: false }))).rejects.toThrow();
    await expect(anonymous(() => f.db.call("set_space_thumbnail", { p_path: null, p_auto: false }))).rejects.toThrow();
    await expect(anonymous(() => f.db.call("space_thumbnail_state"))).rejects.toThrow();
  });

  it("stops serving the moment the Space leaves the public, and stays out of Explore when unlisted", async () => {
    await publish("unlisted", pageId);
    expect(await publicPath()).toBe(path);
    expect((await explore()).total).toBe(0);
    await publish("private", pageId);
    expect(await publicPath()).toBeNull();
  });
});
