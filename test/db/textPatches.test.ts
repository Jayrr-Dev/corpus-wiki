import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { SectionState } from "@/lib/living-page/types";

describe("atomic article patches in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  const section = "00000000-0000-4000-8000-5e0000000001";
  const line = "00000000-0000-4000-8000-110000000001";
  const revision = "00000000-0000-4000-8000-1b0000000001";
  const evidence = [{ unitId: "00000000-0000-4000-8000-010000000001", revisionId: "00000000-0000-4000-8000-0b0000000001" }];
  beforeAll(async () => { store = await portablePostgres(); }, 120000);
  afterAll(async () => { await store?.pg.close(); });
  const read = () => store.db.call<SectionState>("read_section_state", { p_section_id: section });
  const action = (content: string, expected = revision) => ({ type: "revise_line", targetId: line, expectedRevisionId: null, passageIds: [], speechAct: null,
    input: { content, expectedLineRevisionId: expected, unitRevisionIds: [evidence[0]!.revisionId] } });
  const submit = (actions: unknown[]) => store.db.call<{ changeSetId: string }>("submit_change_set", {
    p_event_id: null, p_cause: "edit", p_actor: "ai", p_summary: "Patch article", p_trace: {}, p_actions: actions,
  });
  const commit = (id: string, cites = evidence) => store.db.call<{ status: string }>("commit_text_patch_set", { p_change_set_id: id, p_evidence: cites });

  it("keeps paragraph identity, citations and untouched text, and undo restores the exact revision", async () => {
    const before = await read();
    expect(before.lines[0]!.unitRevisionIds).toEqual([evidence[0]!.revisionId]);
    const text = before.lines[0]!.content.replace("an internal", "a private internal");
    const { changeSetId } = await submit([action(text)]);
    expect((await commit(changeSetId)).status).toBe("applied");
    const after = await read();
    expect(after.lines[0]).toMatchObject({ lineId: line, content: text, position: before.lines[0]!.position, unitRevisionIds: before.lines[0]!.unitRevisionIds });
    await store.db.call("revert_change_set", { p_change_set_id: changeSetId });
    expect((await read()).lines[0]).toEqual(before.lines[0]);
  });
  it("rejects a stale paragraph and a stale evidence snapshot", async () => {
    const before = await read();
    const stale = await submit([action("Bad edit", evidence[0]!.revisionId)]);
    await expect(commit(stale.changeSetId)).rejects.toThrow("paragraph changed");
    const changedEvidence = await submit([action("Bad edit")]);
    await expect(commit(changedEvidence.changeSetId, [{ ...evidence[0]!, revisionId: revision }])).rejects.toThrow("Evidence changed");
    expect(await read()).toEqual(before);
  });
  it("rolls back an earlier valid edit when a later action is rejected", async () => {
    const before = await read();
    // Both targets pass preflight, then the second action's expected revision
    // becomes stale after the first is applied. The outer transaction must undo it.
    const { changeSetId } = await submit([action("Updated internally."), action("Conflicting second edit.")]);
    await expect(commit(changeSetId)).rejects.toThrow();
    expect(await read()).toEqual(before);
    expect((await store.pg.query<{ n: number }>("select count(*)::int n from actions where change_set_id=$1 and outcome='applied'", [changeSetId])).rows[0]!.n).toBe(0);
  });
  it("honors the section cancellation fence for the new commit operation", async () => {
    const before = await read();
    const { changeSetId } = await submit([action("Should not appear")]);
    const result = await store.db.call("section_build_write", { p_section_id: section, p_token: new Date().toISOString(), p_function: "commit_text_patch_set", p_args: { p_change_set_id: changeSetId, p_evidence: evidence } });
    expect(result).toEqual({ buildCancelled: true });
    expect(await read()).toEqual(before);
  });
});
