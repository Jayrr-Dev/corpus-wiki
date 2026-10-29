import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { splitIntoPassages } from "@/lib/ingest/passages";
import { portablePostgres } from "./portablePostgres";

// =====================================================================
// REVIEWER BUDGET (issue #42): an upload over the budget waits on one
// Exception; accepting wakes it, declining stops it with the reason.
// =====================================================================

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });
beforeEach(async () => { await store.pg.exec("begin"); });
afterEach(async () => { await store.pg.exec("rollback"); });

// An upload whose run holds the lease, as after its plan stage
async function runningUpload() {
  const { eventId } = await store.db.call<{ eventId: string }>("ingest_source", {
    p_title: "Budget fixture", p_mime_type: "text/plain", p_source_date: "2026-10-17T00:00:00Z", p_hash: `budget-${crypto.randomUUID()}`, p_storage_path: "test/budget.txt",
    p_passages: splitIntoPassages([{ text: "A source-backed fact.", page: null }]),
  });
  const { token } = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: eventId });
  return { eventId, token };
}
const hold = (eventId: string, token: string) => store.db.call<string>("hold_upload_for_reviewer_budget", { p_event_id: eventId, p_token: token, p_sections: 648, p_estimate: 2592, p_budget: 800 });
const release = (eventId: string, token: string) => store.db.call<boolean>("release_upload_workflow", { p_event_id: eventId, p_token: token, p_state: "waiting" });
const answer = (id: string, accept: boolean) => store.db.call<{ eventId: string }>("resolve_exception", { p_exception_id: id, p_accept: accept, p_note: null });
const waiting = (eventId: string) => store.db.call<boolean>("upload_workflow_waiting", { p_event_id: eventId });
async function workflow(eventId: string) {
  return (await store.pg.query<{ state: string; error: string | null }>("select state,error from public.upload_workflows where event_id=$1", [eventId])).rows[0]!;
}
async function questions(eventId: string) {
  return (await store.pg.query<{ id: string; detail: string; type: string }>(`select e.id,e.evidence->>'detail' detail,a.type::text type from public.exceptions e
    join public.actions a on a.id=e.action_id join public.change_sets s on s.id=a.change_set_id where s.event_id=$1 and e.reason::text='reviewer_budget'`, [eventId])).rows;
}
const recoveryJobs = async (eventId: string) => (await store.pg.query("select 1 from public.upload_recovery_jobs where event_id=$1", [eventId])).rows.length;

it("holds a large upload on one Exception and accepting wakes it to write pages", async () => {
  const { eventId, token } = await runningUpload();
  expect(await hold(eventId, token)).toBe("waiting");
  expect(await hold(eventId, token)).toBe("waiting");
  const [question, ...more] = await questions(eventId);
  expect(more).toHaveLength(0);
  expect(question).toMatchObject({ type: "approve_reviewer_budget", detail: expect.stringContaining("648 sections, about 2592 Reviewer calls, over the budget of 800") });
  expect(await waiting(eventId)).toBe(true);
  expect(await release(eventId, token)).toBe(false);
  expect((await workflow(eventId)).state).toBe("waiting");

  expect(await answer(question!.id, true)).toEqual({ eventId });
  expect(await waiting(eventId)).toBe(false);
  expect((await workflow(eventId)).state).toBe("pending");
  expect(await recoveryJobs(eventId)).toBe(1);
  // The resumed run reads the answer instead of asking again
  const resumed = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: eventId, p_continue: true });
  expect(await hold(eventId, resumed.token)).toBe("approved");
  expect(await questions(eventId)).toHaveLength(1);
});

it("declining stops the upload with the reason and is not retried in the background", async () => {
  const { eventId, token } = await runningUpload();
  await hold(eventId, token);
  await release(eventId, token);
  const [question] = await questions(eventId);
  await answer(question!.id, false);
  expect(await workflow(eventId)).toEqual({ state: "incomplete", error: "Writing pages was declined: about 2592 Reviewer calls for 648 sections is over the budget of 800." });
  expect(await waiting(eventId)).toBe(false);
  expect(await recoveryJobs(eventId)).toBe(0);
  // Resume runs again and gets the same answer, so it stops before writing pages
  const resumed = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: eventId });
  expect(await hold(eventId, resumed.token)).toBe("declined");
  await expect(answer(question!.id, true)).rejects.toThrow("already has a different answer");
});

it("hands an answer that arrives before the run pauses back to that run", async () => {
  const { eventId, token } = await runningUpload();
  await hold(eventId, token);
  const [question] = await questions(eventId);
  await answer(question!.id, true);
  // Releasing as waiting resumes instead, because nothing is left to wait for
  expect(await release(eventId, token)).toBe(true);
  expect((await workflow(eventId)).state).toBe("pending");
});

it("refuses a hold from a run that lost its lease", async () => {
  const { eventId } = await runningUpload();
  await expect(hold(eventId, crypto.randomUUID())).rejects.toThrow("no longer running");
});

it("undoes the approval without touching content", async () => {
  const { eventId, token } = await runningUpload();
  await hold(eventId, token);
  const [question] = await questions(eventId);
  await answer(question!.id, true);
  const action = (await store.pg.query<{ id: string }>("select a.id from public.exceptions e join public.actions a on a.id=e.action_id where e.id=$1", [question!.id])).rows[0]!;
  await store.pg.query("select change_control.undo_action(a, null) from public.actions a where a.id=$1", [action.id]);
  expect((await store.pg.query<{ outcome: string }>("select outcome::text from public.actions where id=$1", [action.id])).rows[0]!.outcome).toBe("reverted");
});
