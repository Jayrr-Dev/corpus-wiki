import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordUpload } from "@/lib/ingest/pipeline";
import { splitIntoPassages } from "@/lib/ingest/passages";
import { portablePostgres } from "./portablePostgres";
import { uploadChangeCounts, uploadFixture } from "./uploadFixture";

type Mark = { kind: string; key: string; version: number };

// ONE CHANGE SET PER STAGE PER UPLOAD (#49): an upload's automatic stages fold
// into one change set each when it completes, and Undo of a stage matches undoing
// each of its old change sets newest first.
describe("stage change sets", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => {
    vi.stubEnv("PROCESSING_SHARED_LIMITS", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Stage change set tests must not access the network"); }));
    store = await portablePostgres();
  }, 60000);
  afterAll(async () => { await store?.pg.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const rows = async <T,>(sql: string, args: unknown[] = []) => (await store.pg.query<T>(sql, args)).rows;
  // Everything Undo restores, without timestamps or the bookkeeping that differs by design
  // (which change set and position an action sits at, and how many revert events Undo wrote)
  async function knowledgeState(eventId: string) {
    const skip: Record<string, string[]> = { actions: ["change_set_id", "position", "reverted_by_event_id"], stale_marks: ["version"] };
    const state: Record<string, unknown[]> = {};
    for (const table of ["units", "revisions", "lines", "line_revisions", "sections", "pages", "actions", "exceptions", "stale_marks"]) {
      const columns = (await rows<{ column_name: string }>(`select column_name from information_schema.columns
        where table_schema='public' and table_name=$1 and data_type not like 'timestamp%' order by ordinal_position`, [table]))
        .map((column) => column.column_name).filter((column) => !skip[table]?.includes(column));
      state[table] = await rows(`select ${columns.map((column) => `"${column}"`).join(",")} from public.${table} order by 1,2`);
    }
    state.event = await rows("select status from public.shift_events where id=$1", [eventId]);
    return state;
  }
  // Runs `body` and throws its changes away, so each Undo starts from the same database
  async function rolledBack<T>(body: () => Promise<T>): Promise<T> {
    await store.pg.exec("begin");
    try { return await body(); } finally { await store.pg.exec("rollback"); }
  }
  const stageSets = (eventId: string) => rows<{ id: string }>(`select distinct c.id, c.created_at from public.change_sets c
    join public.upload_writes w on w.result->>'changeSetId'=c.id::text and w.function_name='submit_change_set'
    where c.event_id=$1 and change_control.upload_stage(w.key)='articles' order by c.created_at desc, c.id desc`, [eventId]);

  it("folds an upload's article stage, cutting change sets per upload over ten times, and Undo of the stage equals undoing each set", async () => {
    // Today's behaviour first: the fold is switched off while the upload runs
    await store.pg.exec("alter table public.upload_workflows disable trigger fold_upload_stages");
    const upload = await uploadFixture(store, "undo", 8, 9);
    await store.pg.exec("alter table public.upload_workflows enable trigger fold_upload_stages");
    expect(upload.result).toMatchObject({ error: null, workflow: { state: "complete" } });
    const before = await uploadChangeCounts(store, upload.eventId);
    const members = await stageSets(upload.eventId);
    expect(members.length).toBeGreaterThan(20);

    const undoneOneByOne = await rolledBack(async () => {
      for (const { id } of members) await store.db.call("revert_upload_knowledge", { p_change_set_id: id });
      return knowledgeState(upload.eventId);
    });
    const { after, undoneAsStage } = await rolledBack(async () => {
      expect(await rows("select change_control.fold_upload_stages($1) folded", [upload.eventId])).toEqual([{ folded: members.length - 1 }]);
      const after = await uploadChangeCounts(store, upload.eventId);
      const [stage] = await rows<{ id: string; stage: string; summary: string; status: string }>(
        "select id, stage, summary, status from public.change_sets where event_id=$1 and stage is not null", [upload.eventId]);
      expect(stage).toMatchObject({ id: members.at(-1)!.id, stage: "articles", status: "applied", summary: "Wrote articles: 8 new articles, 72 line changes" });
      await store.db.call("revert_upload_knowledge", { p_change_set_id: stage!.id });
      return { after, undoneAsStage: await knowledgeState(upload.eventId) };
    });

    expect(after.actions).toBe(before.actions);
    expect(before.sets / after.sets).toBeGreaterThanOrEqual(10);
    expect(undoneAsStage).toEqual(undoneOneByOne);
  }, 120000);

  it("folds when an upload completes, and a repeated run changes nothing", async () => {
    const upload = await uploadFixture(store, "automatic", 4, 6);
    expect(upload.result).toMatchObject({ error: null, workflow: { state: "complete" } });
    const sets = await rows<{ stage: string | null; summary: string }>("select stage, summary from public.change_sets where event_id=$1 order by created_at, id", [upload.eventId]);
    expect(sets).toEqual([{ stage: null, summary: "Fixture automatic" }, { stage: "articles", summary: "Wrote articles: 4 new articles, 24 line changes" }]);
    const counts = await uploadChangeCounts(store, upload.eventId);
    expect(await upload.run()).toMatchObject({ error: null, workflow: { state: "complete" } });
    expect(await uploadChangeCounts(store, upload.eventId)).toEqual(counts);
  }, 120000);

  // Stale marks (#46) come from triggers on units. Folding writes no units, and Undo
  // of a folded stage restores the same claims, so the same items are marked.
  it("keeps stale marks the same, Undo included, and leaves decisions people see unfolded", async () => {
    const glossaryKinds = ["glossary_claim", "glossary_entry"];
    const marks = async () => (await store.db.call<Mark[]>("read_stale_marks", { p_kinds: glossaryKinds })).map(({ kind, key }) => `${kind}:${key}`).sort();
    const clearAll = async () => store.db.call("clear_stale_marks", { p_marks: await store.db.call<Mark[]>("read_stale_marks", { p_kinds: glossaryKinds }) });
    const started = await recordUpload(store.db, { title: "Fixture marks", mimeType: "text/plain", sourceDate: "2026-10-16T00:00:00Z",
      hash: "fixture:marks", storagePath: "fixture/marks.txt", passages: splitIntoPassages([{ page: null, text: "A torque wrench sets bolt tension." }]) });
    if (started.kind !== "started") throw new Error("Expected a new fixture source");
    const eventId = started.eventId;
    const { token } = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: eventId, p_continue: false });
    async function write(key: string, actions: unknown[]) {
      const { changeSetId } = await store.db.call<{ changeSetId: string }>("upload_workflow_write", { p_event_id: eventId, p_token: token, p_key: `${key}:submit`,
        p_function: "submit_change_set", p_args: { p_event_id: eventId, p_cause: "upload", p_actor: "ai", p_summary: key, p_trace: {}, p_actions: actions } });
      await store.db.call("upload_workflow_write", { p_event_id: eventId, p_token: token, p_key: `commit:${changeSetId}`, p_function: "commit_change_set", p_args: { p_change_set_id: changeSetId } });
      return changeSetId;
    }
    const claim = (content: string) => ({ type: "add_claim", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: "stated",
      input: { content, kind: "fact", epistemicStatus: "supported", entities: [], domainPaths: [] } });
    // Knowledge from earlier: the glossary cites the first claim
    const seed = await write("reconcile", [claim("A torque wrench sets bolt tension"), claim("Ladders are inspected monthly")]);
    const [first, second] = await rows<{ target_id: string; after_revision_id: string }>("select target_id, after_revision_id from public.actions where change_set_id=$1 order by position", [seed]);
    await store.pg.exec("update glossary_state set lease_token=null, lease_until=null, status='idle'");
    const glossaryToken = await store.db.call<string>("claim_glossary_generation", { p_hash: "marks", p_force: true });
    await store.db.call("publish_glossary_meanings", { p_token: glossaryToken, p_hash: "published", p_pending: [], p_registry: {}, p_batches: {}, p_complete: false,
      p_entries: [{ meaningId: "meaning-torque", term: "torque", expansion: null, aliases: [], category: "general term", definition: "A definition backed by a claim.",
        context: null, scopeKey: "[null]", usageNotes: [], citations: [{ unitId: first!.target_id, revisionId: first!.after_revision_id, sourceId: "source", sourceTitle: "Source" }] }],
      p_considered: [first, second].map((unit) => ({ unitId: unit!.target_id, revisionId: unit!.after_revision_id })),
      p_marks: await store.db.call<Mark[]>("read_stale_marks", { p_kinds: glossaryKinds }) });
    await clearAll();

    // Two automatic writes of one foldable stage, then a retirement, which waits for a person
    const revise = (unit: { target_id: string; after_revision_id: string }, content: string) => ({ type: "revise_claim", targetId: unit.target_id,
      expectedRevisionId: unit.after_revision_id, passageIds: [], speechAct: "stated", input: { content } });
    const one = await write("section:one", [revise(first!, "A torque wrench sets and checks bolt tension")]);
    const two = await write("section:two", [claim("Harnesses arrest falls")]);
    const retired = await write("section:three", [{ type: "retire_claim", targetId: second!.target_id, expectedRevisionId: second!.after_revision_id,
      passageIds: [], speechAct: null, input: { reason: "Superseded" } }]);
    expect(await rows("select outcome from public.actions where change_set_id = any($1::uuid[]) order by created_at", [[one, two, retired]]))
      .toEqual([{ outcome: "applied" }, { outcome: "applied" }, { outcome: "exception" }]);
    const marked = await marks();
    expect(marked).toContain("glossary_entry:meaning-torque");

    const undoneOneByOne = await rolledBack(async () => {
      await clearAll();
      for (const id of [two, one]) await store.db.call("revert_upload_knowledge", { p_change_set_id: id });
      return marks();
    });
    expect(await store.db.call("release_upload_workflow", { p_event_id: eventId, p_token: token, p_state: "complete" })).toBe(false);
    expect(await marks()).toEqual(marked);
    expect(await rows("select id, stage from public.change_sets where id = any($1::uuid[]) order by created_at", [[one, two, retired]]))
      .toEqual([{ id: one, stage: "articles" }, { id: retired, stage: null }]);
    await clearAll();
    await store.db.call("revert_upload_knowledge", { p_change_set_id: one });
    expect(await marks()).toEqual(undoneOneByOne);
    expect(undoneOneByOne).toContain("glossary_entry:meaning-torque");
  }, 120000);

  // The fold leaves out every change set another table points at. A new reference needs a look at it.
  it("knows every table that points at a change set", async () => {
    expect((await rows<{ source: string }>(`select distinct conrelid::regclass::text source from pg_constraint
      where contype='f' and confrelid='public.change_sets'::regclass order by 1`)).map((row) => row.source))
      .toEqual(["actions", "article_reviews", "page_review_runs", "root_approval_jobs", "upload_workflows"]);
  });
});
