import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";

// Merging duplicates moves their links to the claim that stays, and undo moves them back
describe("links through duplicate merges in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  const context: KnowledgeContext = { entities: [{ type: "company", key: "linkco", role: "subject" }], applicability: { status: "scoped", entities: [{ type: "company", key: "linkco" }], conditions: null } };
  async function submit(type: string, input: unknown, targetId: string | null = null, expectedRevisionId: string | null = null) {
    const draft = await store.db.call<{ changeSetId: string }>("submit_change_set", {
      p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: "Link merge test", p_trace: {},
      p_actions: [{ type, input, targetId, expectedRevisionId, passageIds: [], speechAct: "stated" }],
    });
    const result = await store.db.call<{ status: string }>("commit_change_set", { p_change_set_id: draft.changeSetId });
    const action = (await store.pg.query<{ target_id: string; after_revision_id: string }>("select target_id, after_revision_id from actions where change_set_id=$1", [draft.changeSetId])).rows[0]!;
    return { ...draft, ...action, ...result };
  }
  const add = (content: string) => submit("add_claim", { content, kind: "procedure", epistemicStatus: "supported", entities: context.entities, domainPaths: [], context });
  const link = (from: string, to: string, type = "part_of") => submit("link", { toUnitId: to, type }, from);
  const live = async () => (await store.pg.query<{ id: string; from_unit_id: string; to_unit_id: string; type: string }>(
    "select id, from_unit_id, to_unit_id, type from relationships where retired_at is null order by created_at, id")).rows;

  it("moves a duplicate's links to the claim that stays, retires repeats, and undoes both", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('company','linkco','LinkCo')");
    const procedure = await add("LinkCo locks out equipment before maintenance");
    const kept = await add("LinkCo tags the isolation point");
    const duplicate = await add("LinkCo tags the isolation point.");
    const other = await add("LinkCo tests the machine is dead");
    expect((await link(duplicate.target_id, procedure.target_id)).status).toBe("applied");
    expect((await link(kept.target_id, procedure.target_id)).status).toBe("applied");
    expect((await link(other.target_id, duplicate.target_id, "depends_on")).status).toBe("applied");
    const before = await live();

    const merged = await submit("merge_duplicates", { duplicateUnitIds: [duplicate.target_id], autoMerge: true }, kept.target_id, kept.after_revision_id);
    expect(merged.status).toBe("applied");
    const after = await live();
    // The duplicate's part_of repeated the kept claim's, so it is retired; its depends_on moves
    expect(after.filter((row) => row.from_unit_id === duplicate.target_id || row.to_unit_id === duplicate.target_id)).toEqual([]);
    expect(after.filter((row) => row.to_unit_id === procedure.target_id).map((row) => row.from_unit_id)).toEqual([kept.target_id]);
    expect(after).toContainEqual(expect.objectContaining({ from_unit_id: other.target_id, to_unit_id: kept.target_id, type: "depends_on" }));

    await store.db.call("revert_change_set", { p_change_set_id: merged.changeSetId });
    expect(await live()).toEqual(before);
  });

  it("retires a link that would join the claim that stays to itself", async () => {
    const kept = await add("LinkCo releases the lock after work");
    const duplicate = await add("LinkCo releases the lock after the work");
    await link(duplicate.target_id, kept.target_id, "related_to");
    const merged = await submit("merge_duplicates", { duplicateUnitIds: [duplicate.target_id], autoMerge: true }, kept.target_id, kept.after_revision_id);
    expect(merged.status).toBe("applied");
    expect((await live()).filter((row) => row.from_unit_id === kept.target_id || row.to_unit_id === kept.target_id)).toEqual([]);
  });

  it("undoes a claim even after it was linked", async () => {
    const step = await add("LinkCo verifies zero energy");
    const procedure = await add("LinkCo restarts equipment after checks");
    expect((await link(step.target_id, procedure.target_id)).status).toBe("applied");
    await store.db.call("revert_change_set", { p_change_set_id: step.changeSetId });
    expect((await store.pg.query<{ retired_at: string | null }>("select retired_at from units where id=$1", [step.target_id])).rows[0]!.retired_at).not.toBeNull();
  });
});
