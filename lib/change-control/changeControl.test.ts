import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftAction } from "@/lib/ai/types";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "@/test/db/localPostgres";
import { pgRpc } from "@/test/db/pgRpc";
import { commitChangeSet, commitPersonAction, resolveException, revertChangeSet, submitChangeSet } from ".";

// =====================================================================
// CHANGE CONTROL beyond the evals: accepting a held action, the AI asking
// before it retires, the world-moved rejection, and undo's safety rule.
// Every test starts from the seed (fresh database each).
// =====================================================================

// SEED ROWS (supabase/seed.sql)
const RELEASE_UNIT = "00000000-0000-4000-8000-010000000002";
const RELEASE_REVISION = "00000000-0000-4000-8000-0b0000000002";
const CHARTER_PASSAGE = "00000000-0000-4000-8000-0a0000000003";
const NO_TRACE = { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null };

// A person's revise of the seeded release decision
const reviseRelease = (content: string, expected = RELEASE_REVISION): Extract<DraftAction, { type: "revise_claim" }> => ({
  type: "revise_claim", targetId: RELEASE_UNIT, expectedRevisionId: expected,
  passageIds: [], speechAct: null, input: { content },
});

describe.skipIf(!hasLocalPostgres())("change control", () => {
  let db: LocalPostgres;
  let client: Client;
  const rpc = () => pgRpc(client);

  beforeEach(async () => {
    db = await startLocalPostgres();
    client = await db.connect();
  });

  afterEach(async () => {
    await client?.end();
    await db?.stop();
  });

  // Current content of the release unit
  const releaseContent = async () =>
    (await client.query<{ content: string }>(
      "select r.content from public.units u join public.revisions r on r.id = u.current_revision_id where u.id = $1",
      [RELEASE_UNIT],
    )).rows[0]?.content;

  it("applies a person's edit as its own ChangeSet", async () => {
    const result = await commitPersonAction(rpc(), reviseRelease("Alpha's first release moves to Q2 2027."));
    expect(result).toMatchObject({ status: "applied", applied: 1, eventStatus: "applied" });
    expect(await releaseContent()).toBe("Alpha's first release moves to Q2 2027.");
  });

  it("rejects the whole set when the unit moved since it was drafted", async () => {
    await commitPersonAction(rpc(), reviseRelease("Q2 2027."));
    const stale = await commitPersonAction(rpc(), reviseRelease("Q3 2027."));
    expect(stale).toMatchObject({ status: "rejected", eventStatus: "failed" });
    expect(await releaseContent()).toBe("Q2 2027.");
  });

  it("asks before the AI retires knowledge, and applies it once accepted", async () => {
    const retire: DraftAction = {
      type: "retire_claim", targetId: RELEASE_UNIT, expectedRevisionId: RELEASE_REVISION,
      passageIds: [CHARTER_PASSAGE], speechAct: "stated", input: { reason: "Cancelled", validTo: null },
    };
    const event = (await client.query<{ id: string }>("insert into public.shift_events (cause, actor) values ('upload', 'ai') returning id")).rows[0]!;
    const submitted = await submitChangeSet(rpc(), { eventId: event.id, cause: "upload", actor: "ai" }, { summary: "Retire", actions: [retire], trace: NO_TRACE });
    expect(await commitChangeSet(rpc(), submitted.changeSetId)).toMatchObject({ status: "partly_applied", exceptions: 1 });
    const exception = (await client.query<{ id: string; reason: string }>("select id, reason from public.exceptions")).rows[0]!;
    expect(exception.reason).toBe("deletion");
    await resolveException(rpc(), { exceptionId: exception.id, accept: true, note: null });
    const retired = (await client.query("select retired_at from public.units where id = $1", [RELEASE_UNIT])).rows[0];
    expect(retired?.retired_at).not.toBeNull();
  });

  it("applies an AI merge marked autoMerge without asking, and still asks for any other AI merge", async () => {
    const OTHER_UNIT = "00000000-0000-4000-8000-010000000001";
    const merge = (autoMerge: boolean): DraftAction => ({
      type: "merge_duplicates", targetId: OTHER_UNIT, expectedRevisionId: null, passageIds: [], speechAct: null,
      input: { duplicateUnitIds: [RELEASE_UNIT], ...(autoMerge ? { autoMerge: true } : {}) },
    });
    const commit = async (action: DraftAction) => {
      const submitted = await submitChangeSet(rpc(), { eventId: null, cause: "edit", actor: "ai" }, { summary: "Merge", actions: [action], trace: NO_TRACE });
      return commitChangeSet(rpc(), submitted.changeSetId);
    };
    expect(await commit(merge(false))).toMatchObject({ exceptions: 1 });
    expect((await client.query("select retired_at from public.units where id = $1", [RELEASE_UNIT])).rows[0]?.retired_at).toBeNull();
    expect(await commit(merge(true))).toMatchObject({ status: "applied", applied: 1 });
    expect((await client.query("select retired_at from public.units where id = $1", [RELEASE_UNIT])).rows[0]?.retired_at).not.toBeNull();
  });

  it("gives a revision the title of the action that made it, else the one it replaces", async () => {
    const titled = await commitPersonAction(rpc(), { ...reviseRelease("Q2 2027."), input: { content: "Q2 2027.", title: "Release in Q2 2027" } });
    expect(titled.status).toBe("applied");
    const title = async () => (await client.query<{ title: string | null }>(
      "select r.title from public.units u join public.revisions r on r.id = u.current_revision_id where u.id = $1", [RELEASE_UNIT],
    )).rows[0]?.title;
    expect(await title()).toBe("Release in Q2 2027");
    const revision = (await client.query<{ id: string }>("select current_revision_id as id from public.units where id = $1", [RELEASE_UNIT])).rows[0]!;
    await commitPersonAction(rpc(), reviseRelease("Q2 2027, confirmed.", revision.id));
    expect(await title()).toBe("Release in Q2 2027");
  });

  it("refuses to undo a change a later change built on", async () => {
    const first = await commitPersonAction(rpc(), reviseRelease("Q2 2027."));
    const revision = (await client.query<{ id: string }>("select current_revision_id as id from public.units where id = $1", [RELEASE_UNIT])).rows[0]!;
    await commitPersonAction(rpc(), reviseRelease("Q3 2027.", revision.id));
    await expect(revertChangeSet(rpc(), first.changeSetId)).rejects.toThrow(/Undo that change first/);
  });
});
