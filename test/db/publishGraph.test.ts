import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { PublicationEditor, PublicGraph, PublicWiki } from "@/lib/publishing/types";

describe("publishing a wiki with its graph", () => {
  let f: Awaited<ReturnType<typeof portablePostgres>>;
  const owner = "10000000-0000-4000-8000-000000000041";
  let sid: string, slug: string;
  const units = { titled: "50000000-0000-4000-8000-000000000011", untitled: "50000000-0000-4000-8000-000000000012", hidden: "50000000-0000-4000-8000-000000000013" };
  const revisions = { titled: "50000000-0000-4000-8000-000000000021", untitled: "50000000-0000-4000-8000-000000000022", hidden: "50000000-0000-4000-8000-000000000023" };

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
  const readGraph = () => anonymous(() => f.db.call<PublicGraph | null>("read_public_graph", { p_slug: slug }));
  const readWiki = () => anonymous(() => f.db.call<PublicWiki | null>("read_public_wiki", { p_slug: slug, p_page: "garden", p_embed: false }));
  async function publish(graph?: boolean) {
    const e = await editor();
    return as(owner, sid, () => f.db.call<{ slug: string }>("publish_space_wiki", {
      p_visibility: "public", p_title: "Garden Wiki", p_description: "", p_publisher: "", p_embed: false,
      p_pages: e.pages.filter(p => p.slug === "garden").map(p => ({ id: p.id, fingerprint: p.fingerprint })), ...(graph === undefined ? {} : { p_graph: graph }),
    }));
  }

  beforeAll(async () => {
    f = await portablePostgres();
    await f.pg.query("insert into auth.users(id,email) values($1,'graph-owner@example.test')", [owner]);
    sid = (await as(owner, null, () => f.db.call<{ id: string }>("create_space", { p_name: "Garden" }))).id;
    await as(owner, sid, async () => {
      const event = (await f.pg.query<{ id: string }>("insert into shift_events(cause,actor) values('edit','person') returning id")).rows[0]!.id;
      const domain = (await f.pg.query<{ id: string }>("insert into domains(path,name,proposed_by) values('Growing/Roots','Roots','person') returning id")).rows[0]!.id;
      const secretDomain = (await f.pg.query<{ id: string }>("insert into domains(path,name,proposed_by) values('Secret plans','Secret plans','person') returning id")).rows[0]!.id;
      const addPage = async (title: string, pageSlug: string) => {
        const page = (await f.pg.query<{ id: string }>("insert into pages(title,slug) values($1,$2) returning id", [title, pageSlug])).rows[0]!.id;
        return (await f.pg.query<{ id: string }>("insert into sections(page_id,position,title) values($1,0,'Growing') returning id", [page])).rows[0]!.id;
      };
      const garden = await addPage("Garden", "garden"), privatePage = await addPage("Private plans", "plans");
      const addUnit = async (key: keyof typeof units, content: string, title: string | null) => {
        await f.pg.query("insert into units(id,kind,epistemic_status,current_revision_id,valid_from) values($1,'fact','established',$2,now())", [units[key], revisions[key]]);
        await f.pg.query("insert into revisions(id,unit_id,content,title,passage_ids,source_date,event_id,author) values($1,$2,$3,$4,'{}',now(),$5,'ai')", [revisions[key], units[key], content, title, event]);
      };
      await addUnit("titled", "Full private wording of the titled claim.", "Radish depth");
      await addUnit("untitled", "Full private wording of the untitled claim.", null);
      await addUnit("hidden", "Full private wording of the hidden claim.", "Hidden claim title");
      const addLine = async (section: string, id: number, content: string, cited: string[]) => {
        const line = `30000000-0000-4000-8000-0000000000${id}`, revision = `30000000-0000-4000-8000-0000000001${id}`;
        await f.pg.query("insert into lines(id,section_id,position,current_revision_id) values($1,$2,$3,$4)", [line, section, id, revision]);
        await f.pg.query("insert into line_revisions(id,line_id,content,event_id,author,unit_revision_ids) values($1,$2,$3,$4,'person',$5)", [revision, line, content, event, cited]);
      };
      await addLine(garden, 41, "Plant radishes in deep soil.", [revisions.titled]);
      await addLine(garden, 42, "Water them every morning.", [revisions.untitled]);
      await addLine(privatePage, 43, "A plan nobody should see.", [revisions.hidden]);
      await f.pg.query("insert into unit_domains(unit_id,domain_id) values($1,$2),($3,$4)", [units.titled, domain, units.hidden, secretDomain]);
      await f.pg.query("insert into relationships(from_unit_id,to_unit_id,type,event_id) values($1,$2,'supports',$5),($1,$3,'supports',$5),($3,$4,'supports',$5)", [units.titled, units.untitled, units.hidden, units.untitled, event]);
    });
  });
  afterAll(async () => { await f?.pg.close(); });

  it("publishes no graph unless asked, and tells the app the choice exists", async () => {
    slug = (await publish()).slug;
    const e = await editor();
    expect(e.publishGraph).toBe(true);
    expect(e.publication?.includeGraph).toBe(false);
    expect(e.publication?.hasGraph).toBe(false);
    expect((await readWiki())?.hasGraph).toBe(false);
    expect(await readGraph()).toBeNull();
  });

  it("holds only what the published pages state, with no real ids or claim text", async () => {
    await publish(true);
    expect((await editor()).publication?.hasGraph).toBe(true);
    expect((await readWiki())?.hasGraph).toBe(true);
    const graph = (await readGraph())!;
    expect(graph.pages.map(page => [page.slug, page.title])).toEqual([["garden", "Garden"]]);
    expect(graph.claims.map(claim => claim.label).sort()).toEqual(["Radish depth", "Water them every morning."]);
    expect(graph.claims.find(claim => claim.label === "Radish depth")?.domains).toEqual(["Growing/Roots"]);
    expect(graph.claims[0]?.pages[0]).toMatchObject({ page: "p1", section: "Growing" });
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0]?.kind).toBe("supports");
    const serialized = JSON.stringify(graph);
    for (const secret of ["Full private wording", "Hidden claim", "Private plans", "Secret plans", ...Object.values(units), ...Object.values(revisions), sid, owner]) expect(serialized).not.toContain(secret);
  });

  it("removes the graph at the next publish with the choice off, and when made private", async () => {
    await publish(false);
    expect(await readGraph()).toBeNull();
    await publish(true);
    expect(await readGraph()).not.toBeNull();
    await as(owner, sid, () => f.db.call("publish_space_wiki", { p_visibility: "private", p_title: "x", p_description: "", p_publisher: "", p_embed: false, p_pages: [] }));
    expect((await editor()).publication?.includeGraph).toBe(false);
    expect(await readGraph()).toBeNull();
  });

  it("gives public readers no way to build a graph directly", async () => {
    await expect(anonymous(() => f.db.call("wiki_publication_graph", { p_space: sid }))).rejects.toThrow();
  });
});
