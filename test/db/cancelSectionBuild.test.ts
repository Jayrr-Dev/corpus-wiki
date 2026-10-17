import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

describe("section rewrite cancellation", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  const sectionId = "00000000-0000-4000-8000-5e0000000001";
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  it("cancels an active rewrite without changing its text or restarting automatically", async () => {
    const before = await store.pg.query<{ body: string }>("select body from sections where id=$1", [sectionId]);
    const claim = await store.db.call<{ claimed: boolean; buildToken: string }>("claim_section_build", { p_section_id: sectionId, p_event_id: null });
    expect(claim.claimed).toBe(true);
    expect(claim.buildToken).toBeTruthy();
    await store.db.call("cancel_section_build", { p_section_id: sectionId });
    for (const fn of ["assert", "commit_change_set", "finish_section_build", "mark_section_stale"]) {
      expect(await store.db.call("section_build_write", { p_section_id: sectionId, p_token: claim.buildToken, p_function: fn, p_args: {} })).toEqual({ buildCancelled: true });
    }
    expect(await store.db.call("claim_section_build", { p_section_id: sectionId, p_event_id: null })).toEqual({ claimed: false });
    const row = (await store.pg.query<{ body: string; status: string; build_cancelled: boolean }>("select body,status,build_cancelled from sections where id=$1", [sectionId])).rows[0]!;
    expect(row.body).toBe(before.rows[0]!.body);
    expect(row).toMatchObject({ status: "current", build_cancelled: true });

    await store.db.call("resume_section_build", { p_section_id: sectionId });
    const resumed = await store.db.call<{ claimed: boolean; buildToken: string }>("claim_section_build", { p_section_id: sectionId, p_event_id: null });
    expect(resumed.claimed).toBe(true);
    expect(resumed.buildToken).not.toBe(claim.buildToken);
    expect(await store.db.call("section_build_write", { p_section_id: sectionId, p_token: claim.buildToken, p_function: "mark_section_stale", p_args: {} })).toEqual({ buildCancelled: true });
    expect(await store.db.call("section_build_write", { p_section_id: sectionId, p_token: resumed.buildToken, p_function: "assert", p_args: {} })).toEqual({});
  });

  it("keeps build cancellation RPCs inaccessible to unsigned and browser clients", async () => {
    const result = await store.pg.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.cancel_section_build(uuid)','execute') as allowed");
    expect(result.rows[0]!.allowed).toBe(false);
  });
});
