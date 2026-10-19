import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { LEGACY_SPACE_ID, type Space } from "@/lib/spaces/shared";
import { recordUpload } from "@/lib/ingest/pipeline";

describe("spaces in one database", () => {
  let fixture: Awaited<ReturnType<typeof portablePostgres>>;
  const owner = "10000000-0000-4000-8000-000000000001";
  const other = "10000000-0000-4000-8000-000000000002";
  let research: Space;
  let personal: Space;

  async function request<T>(person: string, space: string | null, run: () => Promise<T>, role = "service_role"): Promise<T> {
    await fixture.pg.exec("begin");
    try {
      await fixture.pg.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role',$3,true),set_config('request.headers',$4,true)", [JSON.stringify({ role, sub: role === "authenticated" ? person : undefined }), role === "authenticated" ? person : "", role, JSON.stringify({ "x-person-id": person, ...(space ? { "x-space-id": space } : {}) })]);
      await fixture.pg.exec(`set local role ${role}; select public.scope_space_request()`);
      const result = await run();
      await fixture.pg.exec("commit");
      return result;
    } catch (error) { await fixture.pg.exec("rollback"); throw error; }
  }

  beforeAll(async () => {
    fixture = await portablePostgres();
    await fixture.pg.exec("grant usage on schema auth to authenticated");
    await fixture.pg.query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'other@example.test')", [owner, other]);
    await request(owner, null, () => fixture.db.call("ensure_my_space"));
    research = await request(owner, null, () => fixture.db.call<Space>("create_space", { p_name: "Research" }));
    personal = await request(other, null, () => fixture.db.call<Space>("ensure_my_space"));
  });
  afterAll(async () => { await fixture?.pg.close(); });

  it("preserves the existing dataset and creates empty spaces owned by each user", async () => {
    expect(research.owner_id).toBe(owner);
    expect(personal.owner_id).toBe(other);
    const count = async () => Number((await fixture.pg.query<{ count: string }>("select count(*) from pages")).rows[0]!.count);
    expect(await request(owner, LEGACY_SPACE_ID, count)).toBeGreaterThan(0);
    expect(await request(owner, research.id, count)).toBe(0);
    expect(await request(other, personal.id, count)).toBe(0);
  });

  it("runs server requests under a role that cannot bypass row security", async () => {
    expect(await request(owner, research.id, async () => (await fixture.pg.query<{ role: string }>("select current_user as role")).rows[0]!.role)).toBe("space_runtime");
    const bypass = await fixture.pg.query<{ rolbypassrls: boolean }>("select rolbypassrls from pg_roles where rolname='space_runtime'");
    expect(bypass.rows[0]!.rolbypassrls).toBe(false);
  });

  it("keeps singleton settings and upserts independent", async () => {
    await request(owner, LEGACY_SPACE_ID, () => fixture.db.call("set_ai_model", { p_model: "original-model" }));
    await request(owner, research.id, () => fixture.db.call("set_ai_model", { p_model: "research-model" }));
    expect(await request(owner, LEGACY_SPACE_ID, () => fixture.db.call("get_workspace_settings"))).toMatchObject({ aiModel: "original-model" });
    expect(await request(owner, research.id, () => fixture.db.call("get_workspace_settings"))).toMatchObject({ aiModel: "research-model" });
    expect(await request(other, personal.id, () => fixture.db.call("get_workspace_settings"))).toMatchObject({ aiModel: null });
  });

  it("selects one space's settings even for a trusted caller that bypasses RLS", async () => {
    const selected = research;
    await request(owner, selected.id, () => fixture.db.call("set_ai_model", { p_model: "research-model" }));
    await fixture.pg.exec("begin");
    try {
      await fixture.pg.query("select set_config('request.headers',$1,true)", [JSON.stringify({ "x-space-id": selected.id })]);
      expect(await fixture.db.call("get_workspace_settings")).toMatchObject({ aiModel: "research-model" });
      await fixture.pg.query("select set_config('request.headers',$1,true)", [JSON.stringify({ "x-space-id": personal.id })]);
      expect(await fixture.db.call("get_workspace_settings")).toMatchObject({ aiModel: null, aiRoleModels: {}, articleCharter: {} });
    } finally { await fixture.pg.exec("rollback"); }
    expect(await request(other, personal.id, () => fixture.db.call("get_workspace_settings"))).toMatchObject({ aiModel: null });
    await expect(request(other, selected.id, () => fixture.db.call("get_workspace_settings"))).rejects.toThrow();
  });

  it("initializes and leases a glossary in a new space without touching another space", async () => {
    const original = await fixture.pg.query("select * from glossary_state where space_id=$1", [LEGACY_SPACE_ID]);
    const token = await request(owner, research.id, () => fixture.db.call<string>("claim_glossary_generation", { p_hash: "research-v1" }));
    expect(token).toBeTruthy();
    expect(await request(owner, research.id, () => fixture.db.call("claim_glossary_generation", { p_hash: "research-v1", p_force: true }))).toBeNull();
    const state = await request(owner, research.id, () => fixture.pg.query<{ status: string; lease_token: string; entries: unknown[] }>("select status,lease_token,entries from glossary_state"));
    expect(state.rows).toEqual([{ status: "generating", lease_token: token, entries: [] }]);
    expect((await fixture.pg.query("select * from glossary_state where space_id=$1", [LEGACY_SPACE_ID])).rows).toEqual(original.rows);
    await request(owner, research.id, () => fixture.pg.exec("update glossary_state set lease_token=null,lease_until=null,status='ready',input_hash='research-v1'"));
    expect(await request(owner, research.id, () => fixture.db.call("claim_glossary_generation", { p_hash: "research-v1" }))).toBeNull();
  });

  it("reads live glossary definitions only from the selected owned space", async () => {
    await request(owner, research.id, () => fixture.pg.exec(`update glossary_state set status='error',live_entries='[{"term":"Private research definition"}]'`));
    const view = await request(owner, research.id, () => fixture.db.call<{ live_entries: { term: string }[] }>("read_glossary_view"), "authenticated");
    expect(view.live_entries).toEqual([{ term: "Private research definition" }]);
    const personalView = await request(other, personal.id, () => fixture.db.call("read_glossary_view"), "authenticated");
    expect(personalView).toBeNull();
    await expect(request(other, research.id, () => fixture.db.call("read_glossary_view"), "authenticated")).rejects.toThrow(/not found or not owned/);
  });

  it("allows the same paths, slugs and file hashes in different spaces", async () => {
    for (const id of [LEGACY_SPACE_ID, research.id]) {
      await request(owner, id, async () => {
        await fixture.pg.exec("insert into domains(name,path,proposed_by) values('Identical topic','Independent topic','person')");
        await fixture.pg.exec("insert into sources(title,mime_type,source_date,hash,storage_path) values('Same file','text/plain',now(),'identical-hash','test/path')");
        await fixture.pg.exec("insert into pages(title,slug) values('Same wiki','same-wiki')");
      });
    }
  });

  it("blocks cross-space relationships and explicit writes into another space", async () => {
    const parent = await request(owner, LEGACY_SPACE_ID, async () => (await fixture.pg.query<{ id: string }>("select id from domains limit 1")).rows[0]!.id);
    await expect(request(owner, research.id, () => fixture.pg.query("insert into domains(name,path,parent_id,proposed_by) values('Bad','Bad',$1,'person')", [parent]))).rejects.toThrow(/foreign key/);
    await expect(request(owner, research.id, () => fixture.pg.query("insert into pages(title,slug,space_id) values('Bad','bad',$1)", [LEGACY_SPACE_ID]))).rejects.toThrow(/row-level security/);
  });

  it("scopes the real upload RPC, its passages, and its workflow triggers", async () => {
    const input = { title: "Independent upload.txt", mimeType: "text/plain", sourceDate: "2026-10-18T00:00:00Z", hash: "space-upload", storagePath: "test/space-upload", passages: [{ position: 0, text: "A new topic.", hash: "space-passage", location: {}, speakerLabel: null }] };
    const original = await request(owner, LEGACY_SPACE_ID, () => recordUpload(fixture.db, input));
    const separate = await request(owner, research.id, () => recordUpload(fixture.db, input));
    expect(original.kind).toBe("started");
    expect(separate.kind).toBe("started");
    expect(separate.sourceId).not.toBe(original.sourceId);
    await request(owner, research.id, async () => {
      const passages = await fixture.pg.query<{ space_id: string }>("select space_id from passages where source_id=$1", [separate.sourceId]);
      expect(passages.rows).toEqual([{ space_id: research.id }]);
      const workflows = await fixture.pg.query<{ space_id: string }>("select w.space_id from upload_workflows w join shift_events e on e.id=w.event_id where e.source_id=$1", [separate.sourceId]);
      expect(workflows.rows).toEqual([{ space_id: research.id }]);
    });
  });

  it("authorizes header-free Realtime reads by ownership across both spaces", async () => {
    await fixture.pg.exec("begin");
    try {
      await fixture.pg.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.headers','',true)", [JSON.stringify({ role: "authenticated", sub: owner }), owner]);
      await fixture.pg.exec("set local role authenticated");
      const result = await fixture.pg.query<{ space_id: string }>("select distinct space_id from pages");
      expect(result.rows.map((row) => row.space_id).sort()).toEqual([LEGACY_SPACE_ID, research.id].sort());
    } finally { await fixture.pg.exec("rollback"); }
  });

  it("does not leak original content through SECURITY DEFINER readers", async () => {
    const original = await request(owner, LEGACY_SPACE_ID, () => fixture.db.call<unknown[]>("article_index"));
    const separate = await request(other, personal.id, () => fixture.db.call<unknown[]>("article_index"));
    expect(JSON.stringify(original)).toContain("Alpha");
    expect(JSON.stringify(separate)).not.toContain("Alpha");
  });

  it("rejects another user's space for server and browser requests", async () => {
    for (const role of ["service_role", "authenticated"]) {
      await expect(request(other, research.id, () => fixture.pg.query("select * from pages"), role)).rejects.toThrow(/not found or not owned/);
    }
  });

  it("keeps browser access read-only and only lists owned spaces", async () => {
    const names = await request(owner, research.id, async () => (await fixture.pg.query<{ name: string }>("select name from spaces")).rows.map((row) => row.name), "authenticated");
    expect(names).toEqual(expect.arrayContaining(["My Space", "Research"]));
    expect(names).toHaveLength(2);
    await expect(request(owner, research.id, () => fixture.pg.exec("insert into pages(title,slug) values('Forbidden','forbidden')"), "authenticated")).rejects.toThrow(/permission denied|row-level security/);
  });

  it("keeps account profiles private for both browser and server readers", async () => {
    for (const role of ["authenticated", "service_role"]) {
      const result = await request(other, personal.id, () => fixture.pg.query<{ id: string; email: string }>("select id,email from profiles"), role);
      expect(result.rows).toEqual([{ id: other, email: "other@example.test" }]);
    }
  });

  it("validates names in the database as well as the UI", async () => {
    for (const name of ["   ", "x".repeat(81)]) await expect(request(owner, research.id, () => fixture.db.call("create_space", { p_name: name }))).rejects.toThrow(/between 1 and 80/);
  });

  it("renames only owned spaces and validates the new name", async () => {
    await expect(request(other, personal.id, () => fixture.db.call("rename_space", { p_id: research.id, p_name: "Not yours" }))).rejects.toThrow(/not found or not owned/);
    for (const name of [" ", "x".repeat(81)]) {
      await expect(request(owner, research.id, () => fixture.db.call("rename_space", { p_id: research.id, p_name: name }))).rejects.toThrow(/between 1 and 80/);
    }
    const renamed = await request(owner, research.id, () => fixture.db.call<Space>("rename_space", { p_id: research.id, p_name: "  Independent research  " }));
    expect(renamed).toMatchObject({ id: research.id, name: "Independent research", owner_id: owner });
    research = renamed;
    const pages = await request(owner, research.id, () => fixture.pg.query("select id from pages"));
    expect(pages.rows).toHaveLength(1);
  });

  it("requires the exact current name and ownership to delete", async () => {
    for (const name of ["", "Research", "independent research", "Independent research "]) {
      await expect(request(owner, research.id, () => fixture.db.call("delete_space", { p_id: research.id, p_name: name }))).rejects.toThrow(/exactly/);
    }
    await expect(request(other, personal.id, () => fixture.db.call("delete_space", { p_id: research.id, p_name: research.name }))).rejects.toThrow(/not found or not owned/);
    await expect(request(owner, research.id, () => fixture.db.call("delete_space", { p_id: research.id, p_name: research.name }), "authenticated")).rejects.toThrow(/permission denied/);
  });

  it("deletes a populated space, returns a fallback, and blocks its content and workers", async () => {
    const replacement = await request(owner, research.id, () => fixture.db.call("delete_space", { p_id: research.id, p_name: research.name }));
    expect(replacement).toBe(LEGACY_SPACE_ID);
    const visible = await request(owner, LEGACY_SPACE_ID, () => fixture.pg.query<{ id: string }>("select id from spaces"), "authenticated");
    expect(visible.rows).toEqual([{ id: LEGACY_SPACE_ID }]);
    for (const role of ["service_role", "authenticated"]) {
      await expect(request(owner, research.id, () => fixture.pg.query("select id from pages"), role)).rejects.toThrow(/not found or not owned/);
    }
    // A worker already holding this ID must also be rejected after deletion.
    await expect(request("", research.id, () => fixture.db.call("current_space_id"))).rejects.toThrow(/not found or not owned/);
    const workers = await request(owner, LEGACY_SPACE_ID, () => fixture.db.call<string[]>("worker_spaces"));
    expect(workers).not.toContain(research.id);
    const first = await request(owner, LEGACY_SPACE_ID, () => fixture.db.call<Space>("ensure_my_space"));
    expect(first.id).toBe(LEGACY_SPACE_ID);
    expect(await request(other, personal.id, () => fixture.db.call<Space>("ensure_my_space"))).toMatchObject({ id: personal.id });
    await expect(request(owner, LEGACY_SPACE_ID, () => fixture.db.call("rename_space", { p_id: research.id, p_name: "Bring back" }))).rejects.toThrow(/not found or not owned/);
  });

  it("prevents deletion of the last remaining space", async () => {
    await expect(request(other, personal.id, () => fixture.db.call("delete_space", { p_id: personal.id, p_name: personal.name }))).rejects.toThrow(/Keep at least one space/);
    await expect(request(owner, LEGACY_SPACE_ID, () => fixture.db.call("delete_space", { p_id: LEGACY_SPACE_ID, p_name: "My Space" }))).rejects.toThrow(/Keep at least one space/);
  });

  it("excludes deleted spaces from header-free Realtime authorization", async () => {
    await fixture.pg.exec("begin");
    try {
      await fixture.pg.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.headers','',true)", [JSON.stringify({ role: "authenticated", sub: owner }), owner]);
      await fixture.pg.exec("set local role authenticated");
      expect(await fixture.db.call("readable_space_ids")).toEqual([LEGACY_SPACE_ID]);
      const visible = await fixture.pg.query<{ space_id: string }>("select distinct space_id from pages");
      expect(visible.rows).toEqual([{ space_id: LEGACY_SPACE_ID }]);
    } finally { await fixture.pg.exec("rollback"); }
  });

  it("allows deletion of the original space and gives legacy captures a live fallback", async () => {
    const next = await request(owner, LEGACY_SPACE_ID, () => fixture.db.call<Space>("create_space", { p_name: "Replacement" }));
    expect(await request(owner, LEGACY_SPACE_ID, () => fixture.db.call("delete_space", { p_id: LEGACY_SPACE_ID, p_name: "My Space" }))).toBe(next.id);
    expect(await request("", null, () => fixture.db.call("current_space_id"))).toBe(next.id);
    expect(await request(owner, next.id, () => fixture.db.call<Space>("ensure_my_space"))).toMatchObject({ id: next.id });
    await expect(request(owner, next.id, () => fixture.db.call("delete_space", { p_id: next.id, p_name: next.name }))).rejects.toThrow(/Keep at least one space/);
  });
});
