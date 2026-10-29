import type { DraftChangeSet, ReconciliationInput } from "@/lib/ai/types";
import { resolveException } from "@/lib/change-control";
import { FakeSectionWriter } from "@/lib/living-page";
import { portablePostgres } from "@/test/db/portablePostgres";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { splitIntoPassages } from "./passages";
import { reconcileUpload, recordUpload, type PipelineDeps } from "./pipeline";

// =====================================================================
// REVIEWER BUDGET IN THE UPLOAD WORKFLOW (issue #42): with a budget of one
// call, every article build is over it. The upload saves its knowledge and
// plans its pages, then waits on Exceptions before writing any line.
// =====================================================================

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });
beforeEach(async () => { await store.pg.exec("begin"); vi.stubEnv("REVIEWER_CALL_BUDGET", "1"); });
afterEach(async () => { vi.unstubAllEnvs(); await store.pg.exec("rollback"); });

async function upload() {
  const result = await recordUpload(store.db, {
    title: "Budget team", mimeType: "text/plain", sourceDate: "2026-10-16T00:00:00Z", hash: `budget-${crypto.randomUUID()}`, storagePath: "test/budget.txt",
    passages: splitIntoPassages([{ page: null, text: "Budget team trains monthly. Budget team retains training records." }]),
  });
  if (result.kind !== "started") throw new Error("Expected new upload");
  return result;
}
function deps(): PipelineDeps {
  const draftChangeSet = vi.fn(async (input: ReconciliationInput): Promise<DraftChangeSet> => ({
    summary: "Budget training", trace: { modelVersion: "fixture", promptVersion: "v1", tokensIn: 10, tokensOut: 10 },
    actions: [
      { type: "create_entity", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
        input: { type: "team", key: "budget-team", name: "Budget team", aliases: [] } },
      ...["Budget team trains monthly.", "Budget team retains training records."].map((content) => ({
        type: "add_claim" as const, targetId: null, expectedRevisionId: null, passageIds: [input.passages[0]!.id], speechAct: "stated" as const,
        input: { content, kind: "fact" as const, epistemicStatus: "supported" as const, validFrom: input.source.sourceDate,
          entities: [{ type: "team", key: "budget-team", role: "subject" as const }], domainPaths: [] },
      })),
    ],
  }));
  return { db: store.db, reconciler: { name: "fixture", draftChangeSet }, writer: new FakeSectionWriter(),
    entityDescriber: vi.fn(async () => {}), claimEmbedder: vi.fn(async () => {}), hierarchyOrganizer: vi.fn(async () => {}), deduper: vi.fn(async () => {}) };
}
const writtenLines = async () => (await store.pg.query("select 1 from public.line_revisions where content like 'Budget team%'")).rows.length;
async function question(eventId: string) {
  return (await store.pg.query<{ id: string }>(`select x.id from public.exceptions x join public.actions a on a.id=x.action_id
    join public.change_sets c on c.id=a.change_set_id where c.event_id=$1 and x.reason::text='reviewer_budget'`, [eventId])).rows;
}

it("holds the upload before its pages are written and accepting resumes it", async () => {
  const source = await upload(); const pipeline = deps();
  const first = await reconcileUpload(pipeline, source.eventId);
  expect(first.workflow?.state).toBe("waiting");
  expect(first.workflow?.waiting).toBe(true);
  expect(await writtenLines()).toBe(0);
  const [held] = await question(source.eventId);
  await resolveException(store.db, { exceptionId: held!.id, accept: true, note: null });
  // The answer wakes the upload; the recovery runner continues it
  expect((await store.pg.query<{ state: string }>("select state from public.upload_workflows where event_id=$1", [source.eventId])).rows[0]!.state).toBe("pending");
  const resumed = await reconcileUpload(pipeline, source.eventId, "articles", true);
  expect(resumed.error).toBeNull();
  expect(resumed.workflow?.state).toBe("complete");
  expect(await writtenLines()).toBeGreaterThanOrEqual(2);
  expect(await question(source.eventId)).toHaveLength(1);
});

it("declining stops the upload with the reason and writes no pages", async () => {
  const source = await upload(); const pipeline = deps();
  expect((await reconcileUpload(pipeline, source.eventId)).workflow?.state).toBe("waiting");
  const [held] = await question(source.eventId);
  await resolveException(store.db, { exceptionId: held!.id, accept: false, note: "Too large for now." });
  const resumed = await reconcileUpload(pipeline, source.eventId);
  expect(resumed.workflow?.state).toBe("incomplete");
  expect(resumed.error).toMatch(/^Writing pages was declined: about \d+ Reviewer calls for \d+ sections is over the budget of 1\.$/);
  expect(await writtenLines()).toBe(0);
});

it("writes pages without asking when the build is under the budget", async () => {
  vi.stubEnv("REVIEWER_CALL_BUDGET", "1000");
  const source = await upload(); const pipeline = deps();
  expect((await reconcileUpload(pipeline, source.eventId)).workflow?.state).toBe("complete");
  expect(await question(source.eventId)).toHaveLength(0);
  expect(await writtenLines()).toBeGreaterThanOrEqual(2);
});
