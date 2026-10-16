import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { portablePostgres } from "@/test/db/portablePostgres";
import { commitChangeSet, resolveException, revertChangeSet, submitChangeSet } from "@/lib/change-control";
import { placementActions } from "@/lib/ai/tokenFactory/placeTopics";
import type { DraftAction, DraftChangeSet, ReconciliationInput } from "@/lib/ai/types";
import { FakeSectionWriter } from "@/lib/living-page";
import { reconcileUpload, recordUpload, finishApprovedUpload, type PipelineDeps } from "./pipeline";
import { reportUploadProgress, uploadExecution, workflowWrite } from "./workflowContext";
import { splitIntoPassages } from "./passages";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { articlesPending, canResumeUpload, workflowLabel, type UploadWorkflow } from "./workflowTypes";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("persistent upload pipeline with real change control and pages", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); });
  afterAll(async () => { await store.pg.close(); });
  beforeEach(async () => { await store.pg.exec("begin"); });
  afterEach(async () => { await store.pg.exec("rollback"); });

  async function upload() {
    const result = await recordUpload(store.db, {
      title: "Workflow team", mimeType: "text/plain", sourceDate: "2026-10-16T00:00:00Z",
      hash: "workflow-test", storagePath: "test/workflow.txt",
      passages: splitIntoPassages([{ page: null, text: "Workflow team trains monthly. Workflow team retains training records." }]),
    });
    if (result.kind !== "started") throw new Error("Expected new upload");
    return result;
  }
  // root: the draft proposes a new root "Workflow team"; topic: the claims sit in a topic under it
  function deps(root = false, topic?: string): PipelineDeps & { draft: ReturnType<typeof vi.fn> } {
    const draft = vi.fn(async (input: ReconciliationInput): Promise<DraftChangeSet> => ({
      summary: "Workflow training", trace: { modelVersion: "fixture", promptVersion: "v1", tokensIn: 10, tokensOut: 10 },
      actions: [
        ...(root ? [{ type: "create_domain" as const, targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
          input: { name: "Workflow team", path: "Workflow team", parentPath: null } }] : []),
        ...(root && topic ? [{ type: "create_domain" as const, targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
          input: { name: topic, path: `Workflow team/${topic}`, parentPath: "Workflow team" } }] : []),
        { type: "create_entity", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
          input: { type: "team", key: "workflow-team", name: "Workflow team", aliases: [] } },
        ...["Workflow team trains monthly.", "Workflow team retains training records."].map((content) => ({
          type: "add_claim" as const, targetId: null, expectedRevisionId: null, passageIds: [input.passages[0]!.id], speechAct: "stated" as const,
          input: { content, kind: "fact" as const, epistemicStatus: "supported" as const, validFrom: input.source.sourceDate,
            entities: [{ type: "team", key: "workflow-team", role: "subject" as const }], domainPaths: root ? [topic ? `Workflow team/${topic}` : "Workflow team"] : [] },
        })),
      ],
    }));
    // The topic step without the model: every unfiled claim of the upload goes under the root (or its topic)
    const topicPlacer = root ? vi.fn(async (eventId: string) => {
      const { claims, domainPaths } = await store.db.call<{ claims: { unitId: string }[]; domainPaths: string[] }>("upload_unplaced_claims", { p_event_id: eventId });
      if (!claims.length) return;
      const placed = new Map(claims.map((claim) => [claim.unitId, [topic ? `Workflow team/${topic}` : "Workflow team"]]));
      const { changeSetId } = await submitChangeSet(store.db, { eventId, cause: "upload", actor: "ai", operationKey: "place:submit" },
        { summary: "Filed", actions: placementActions(placed, domainPaths, "Filed"), trace: { modelVersion: "fixture", promptVersion: "v1", tokensIn: 0, tokensOut: 0 } });
      await commitChangeSet(store.db, changeSetId);
    }) : undefined;
    return { db: store.db, reconciler: { name: "fixture", draftChangeSet: draft }, writer: new FakeSectionWriter(), draft, topicPlacer,
      entityDescriber: vi.fn(async () => {}), claimEmbedder: vi.fn(async () => {}), hierarchyOrganizer: vi.fn(async () => {}), deduper: vi.fn(async () => {}) };
  }
  async function count(table: string) { return (await store.pg.query<{ count: number }>(`select count(*)::integer count from public.${table}`)).rows[0]!.count; }

  it("runs extraction through committed claims and real generated page lines; a second call does nothing", async () => {
    const source = await upload(); const pipeline = deps();
    // The glossary is knowledge: it is written before any page, so pages are built once
    const dictionary = vi.fn(async () => {
      expect(await store.pg.query("select id from public.pages where title='Workflow team'")).toHaveProperty("rows.length", 0);
    });
    pipeline.glossaryGenerator = dictionary;
    const result = await reconcileUpload(pipeline, source.eventId);
    expect(result.error).toBeNull();
    expect(result.workflow?.state).toBe("complete");
    expect(await store.pg.query("select id from public.pages where title='Workflow team'")).toHaveProperty("rows.length", 1);
    expect((await store.pg.query("select content from public.line_revisions where content like 'Workflow team%'")).rows.length).toBeGreaterThanOrEqual(2);
    const before = await count("change_sets");
    await reconcileUpload(pipeline, source.eventId);
    expect(await count("change_sets")).toBe(before);
    expect(pipeline.draft).toHaveBeenCalledTimes(1);
    expect(dictionary).toHaveBeenCalledTimes(1);
  });

  it("persists partial failure and retries pages without repeating completed roles or extraction", async () => {
    const source = await upload(); const pipeline = deps(); const real = pipeline.writer.reviseSection.bind(pipeline.writer);
    pipeline.writer.reviseSection = vi.fn().mockRejectedValueOnce(new Error("Writer unavailable")).mockImplementation(real);
    const first = await reconcileUpload(pipeline, source.eventId);
    expect(first.workflow?.state).toBe("incomplete");
    expect(first.status).toBe("applied");
    expect(first.error).toContain("Writer unavailable");
    const second = await reconcileUpload(pipeline, source.eventId);
    expect(second.workflow?.state).toBe("complete");
    expect(second.error).toBeNull();
    expect(pipeline.draft).toHaveBeenCalledTimes(1);
    expect(pipeline.entityDescriber).toHaveBeenCalledTimes(1);
    expect(pipeline.deduper).toHaveBeenCalledTimes(1);
  });

  it("holds new roots before enrichment and resumes through the existing approval function", async () => {
    const source = await upload(); const pipeline = deps(true);
    const first = await reconcileUpload(pipeline, source.eventId);
    expect(first.workflow?.state).toBe("waiting");
    expect(pipeline.entityDescriber).not.toHaveBeenCalled();
    const exception = (await store.pg.query<{ id: string }>("select x.id from public.exceptions x join public.actions a on a.id=x.action_id join public.change_sets c on c.id=a.change_set_id where c.event_id=$1 and x.reason='root_domain_approval'", [source.eventId])).rows[0]!;
    await resolveException(store.db, { exceptionId: exception.id, accept: true, note: null });
    await finishApprovedUpload(pipeline, source.eventId);
    const final = await reconcileUpload(pipeline, source.eventId);
    expect(final.workflow?.state).toBe("complete");
    expect(pipeline.draft).toHaveBeenCalledTimes(1);
    expect(pipeline.entityDescriber).toHaveBeenCalledTimes(1);
  });

  it("keeps a topic the upload placed under an approved root where it is when the context is organized", async () => {
    const source = await upload(); const pipeline = deps(true, "Training");
    await reconcileUpload(pipeline, source.eventId);
    const exception = (await store.pg.query<{ id: string }>("select x.id from public.exceptions x join public.actions a on a.id=x.action_id join public.change_sets c on c.id=a.change_set_id where c.event_id=$1 and x.reason='root_domain_approval'", [source.eventId])).rows[0]!;
    await resolveException(store.db, { exceptionId: exception.id, accept: true, note: null });
    await finishApprovedUpload(pipeline, source.eventId);
    // What organizeExistingEntityContext does: attach the approved root, then organize the context
    const entity = (await store.pg.query<{ id: string }>("select id from public.entities where key='workflow-team'")).rows[0]!;
    await store.pg.query("update public.domains set context_entity_id=$1 where path='Workflow team' and parent_id is null", [entity.id]);
    await store.db.call("organize_entity_context", { p_entity_id: entity.id });
    const paths = (await store.pg.query<{ path: string }>("select path from public.domains where path like 'Workflow team%' and retired_at is null order by path")).rows.map((row) => row.path);
    expect(paths).toEqual(["Workflow team", "Workflow team/Training"]);
  });

  it("saves claims before a new root is approved, files them after, and both changes undo cleanly", async () => {
    const source = await upload(); const pipeline = deps(true, "Training");
    const topicsOf = async () => (await store.pg.query<{ path: string }>(`select d.path from public.unit_domains ud join public.domains d on d.id=ud.domain_id
      join public.units u on u.id=ud.unit_id join public.revisions r on r.id=u.current_revision_id where r.content like 'Workflow team%' and u.retired_at is null order by d.path`)).rows.map((row) => row.path);
    const liveClaims = async () => (await store.pg.query("select u.id from public.units u join public.revisions r on r.id=u.current_revision_id where r.content like 'Workflow team%' and u.retired_at is null")).rows.length;
    const first = await reconcileUpload(pipeline, source.eventId);
    // The knowledge is saved at once; only its filing waits for the root
    expect(first.workflow?.state).toBe("waiting");
    expect(await liveClaims()).toBe(2);
    expect(await topicsOf()).toEqual([]);
    const exception = (await store.pg.query<{ id: string }>("select x.id from public.exceptions x join public.actions a on a.id=x.action_id join public.change_sets c on c.id=a.change_set_id where c.event_id=$1 and x.reason='root_domain_approval'", [source.eventId])).rows[0]!;
    await resolveException(store.db, { exceptionId: exception.id, accept: true, note: null });
    await finishApprovedUpload(pipeline, source.eventId);
    expect(await topicsOf()).toEqual(["Workflow team/Training", "Workflow team/Training"]);
    // Undo the filing: the claims lose the topics it gave them
    const placement = (await store.pg.query<{ id: string }>("select c.id from public.change_sets c join public.actions a on a.change_set_id=c.id where c.event_id=$1 and a.type='place_claim' limit 1", [source.eventId])).rows[0]!;
    await revertChangeSet(store.db, placement.id);
    expect(await topicsOf()).toEqual([]);
    // Filing never blocks undoing the upload that added the claims
    await revertChangeSet(store.db, first.changeSetId!);
    expect(await liveClaims()).toBe(0);
  });

  it("leaves topics out of an upload's extracted draft, links still pointing at their claims", async () => {
    const source = await upload(); const pipeline = deps(true, "Training");
    let saved: { type: string }[] = [];
    pipeline.duplicateGuard = undefined;
    const draftChangeSet = pipeline.reconciler.draftChangeSet;
    pipeline.reconciler = { name: "fixture", draftChangeSet: async (input) => {
      expect(input.fileTopicsLater).toBe(true);
      const draft = await draftChangeSet(input);
      return { ...draft, actions: [...draft.actions, { type: "link", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
        input: { toUnitId: null, type: "related_to", fromPosition: 4, toPosition: 3 } }] };
    } };
    const first = await reconcileUpload(pipeline, source.eventId, "knowledge");
    saved = (await store.pg.query<{ type: string }>("select type::text from public.actions where change_set_id=$1 order by position", [first.changeSetId])).rows;
    expect(saved.map((action) => action.type)).toEqual(["create_entity", "add_claim", "add_claim", "link"]);
    // The link still joins the two claims (positions 4 and 3 before the two topic creates were dropped)
    const ends = (await store.pg.query<{ a: string; b: string }>("select ra.content a, rb.content b from public.relationships l join public.units ua on ua.id=l.from_unit_id join public.revisions ra on ra.id=ua.current_revision_id join public.units ub on ub.id=l.to_unit_id join public.revisions rb on rb.id=ub.current_revision_id")).rows;
    expect(ends).toEqual([{ a: "Workflow team retains training records.", b: "Workflow team trains monthly." }]);
  });

  it("a purge finds the topics and entities only the file created, retires them with its claims, and closes its uploads", async () => {
    const source = await upload(); const pipeline = deps(true, "Training");
    await reconcileUpload(pipeline, source.eventId);
    const exception = (await store.pg.query<{ id: string }>("select x.id from public.exceptions x join public.actions a on a.id=x.action_id join public.change_sets c on c.id=a.change_set_id where c.event_id=$1 and x.reason='root_domain_approval'", [source.eventId])).rows[0]!;
    await resolveException(store.db, { exceptionId: exception.id, accept: true, note: null });
    await finishApprovedUpload(pipeline, source.eventId);
    const ids = async (sql: string) => (await store.pg.query<{ id: string }>(sql)).rows.map((row) => row.id);
    const claims = await ids("select u.id from public.units u join public.revisions r on r.id=u.current_revision_id where r.content like 'Workflow team%' and u.retired_at is null");
    const [root] = await ids("select id from public.domains where path='Workflow team'");
    const [team] = await ids("select id from public.entities where key='workflow-team'");
    // Retiring only one claim keeps the topic and the entity: the other claim still uses them
    expect(await store.db.call("purge_leftovers", { p_source_id: source.sourceId, p_retiring: claims.slice(0, 1) })).toEqual({ pageIds: [], domainIds: [], entityIds: [] });
    const leftovers = await store.db.call<{ pageIds: string[]; domainIds: string[]; entityIds: string[] }>("purge_leftovers", { p_source_id: source.sourceId, p_retiring: claims });
    // The file's article, the highest topic of its branch (retiring it retires "Workflow team/Training" too) and the entity
    const pages = await ids(`select a.target_id id from public.actions a join public.change_sets c on c.id=a.change_set_id where c.event_id='${source.eventId}' and a.type='create_page' and a.outcome='applied'`);
    expect(pages.length).toBeGreaterThan(0);
    expect(leftovers).toEqual({ pageIds: pages, domainIds: [root], entityIds: [team] });
    const retire = (type: "retire_claim" | "retire_page" | "retire_domain" | "retire_entity", targetId: string) => ({ type, targetId, expectedRevisionId: null, passageIds: [], speechAct: null,
      input: type === "retire_claim" ? { reason: "purged", validTo: null } : type === "retire_page" ? {} : { reason: "purged" } }) as DraftAction;
    const { changeSetId } = await submitChangeSet(store.db, { eventId: null, cause: "edit", actor: "person" }, { summary: "Purge",
      actions: [...claims.map((id) => retire("retire_claim", id)), ...leftovers.pageIds.map((id) => retire("retire_page", id)), retire("retire_domain", root!), retire("retire_entity", team!)],
      trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null } });
    expect((await commitChangeSet(store.db, changeSetId)).status).toBe("applied");
    expect(await ids("select id from public.domains where path like 'Workflow team%' and retired_at is null")).toEqual([]);
    expect(await ids(`select id from public.pages where retired_at is null and id in ('${pages.join("','")}')`)).toEqual([]);
    await store.pg.query("update public.upload_workflows set state='incomplete' where event_id=$1", [source.eventId]);
    await store.db.call("close_source_uploads", { p_source_id: source.sourceId });
    const [workflow] = await store.db.call<UploadWorkflow[]>("read_upload_workflows", { p_event_ids: [source.eventId] });
    expect(workflow).toMatchObject({ state: "complete", error: "The file was removed, so its processing stopped." });
    expect(workflowLabel(workflow!)).toBe("Processing stopped");
    expect(canResumeUpload(workflow!)).toBe(false);
  });

  it("recovers a lost commit response without submitting or applying twice", async () => {
    const source = await upload(); const pipeline = deps(); let loseReply = true;
    pipeline.db = { call: async (fn, args) => {
      const answer = await store.db.call(fn, args);
      if (fn === "upload_workflow_write" && args?.p_function === "commit_change_set" && loseReply) {
        loseReply = false; throw new Error("Connection lost after commit");
      }
      return answer as never;
    } };
    const first = await reconcileUpload(pipeline, source.eventId);
    expect(first.workflow?.state).toBe("incomplete");
    const second = await reconcileUpload(pipeline, source.eventId);
    expect(second.workflow?.state).toBe("complete");
    expect(pipeline.draft).toHaveBeenCalledTimes(1);
    expect((await store.pg.query("select id from public.change_sets where event_id=$1 and summary='Workflow training'", [source.eventId])).rows).toHaveLength(1);
  });

  it("denies concurrent owners and fences a worker after its lease is reclaimed", async () => {
    const source = await upload();
    const first = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: source.eventId });
    expect(await store.db.call("claim_upload_workflow", { p_event_id: source.eventId })).toEqual({ claimed: false });
    await store.pg.query("update public.upload_workflows set lease_until=now()-interval '1 second' where event_id=$1", [source.eventId]);
    const second = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: source.eventId });
    expect(second.token).not.toBe(first.token);
    await expect(uploadExecution.run({ eventId: source.eventId, token: first.token, db: store.db }, () =>
      submitChangeSet(store.db, { eventId: source.eventId, cause: "upload", actor: "ai", operationKey: "reconcile:submit" },
        { summary: "late", actions: [], trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null } }))).rejects.toThrow("ownership expired");
  });

  it("rejects unsupported workflow writes", async () => {
    const source = await upload();
    const owner = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: source.eventId });
    await expect(uploadExecution.run({ eventId: source.eventId, token: owner.token, db: store.db }, () =>
      workflowWrite(store.db, "unsafe", "revert_change_set", {}))).rejects.toThrow("Unsupported workflow write");
  });

  it("refuses to resume an archived source", async () => {
    const source = await upload();
    await store.pg.query("update public.sources set archived_at=now(),archive_reason='test' where id=$1", [source.sourceId]);
    await expect(reconcileUpload(deps(), source.eventId)).rejects.toThrow("active internal upload");
  });

  it("does not grant workflow writes or raw outputs to authenticated browser clients", async () => {
    const access = await store.pg.query<{ rpc: boolean; table_access: boolean }>(`select
      has_function_privilege('authenticated','public.claim_upload_workflow(uuid,boolean)','execute') rpc,
      has_table_privilege('authenticated','public.upload_steps','select') table_access`);
    expect(access.rows[0]).toEqual({ rpc: false, table_access: false });
    const source = await upload();
    await store.db.call("claim_upload_workflow", { p_event_id: source.eventId });
    await store.pg.exec("set local role authenticated");
    const summaries = await store.db.call<Record<string, unknown>[]>("read_upload_workflows", { p_event_ids: [source.eventId] });
    expect(summaries[0]).not.toHaveProperty("token");
    expect(summaries[0]).not.toHaveProperty("output");
    await store.pg.exec("reset role");
  });

  it("stops dependent roles after expansion failure, then resumes them after expansion succeeds", async () => {
    const source = await upload(); const pipeline = deps();
    pipeline.knowledgeExpander = vi.fn().mockRejectedValueOnce(new Error("Expansion interrupted")).mockResolvedValue(undefined);
    const first = await reconcileUpload(pipeline, source.eventId);
    expect(first.workflow?.state).toBe("incomplete");
    expect(first.workflow?.steps.some((step) => step.key === "pages")).toBe(false);
    // Knowledge cleanup finished before the articles started, so it is not repeated
    expect(pipeline.deduper).toHaveBeenCalledTimes(1);
    const second = await reconcileUpload(pipeline, source.eventId);
    expect(second.workflow?.state).toBe("complete");
    expect(pipeline.knowledgeExpander).toHaveBeenCalledTimes(2);
    expect(pipeline.entityDescriber).toHaveBeenCalledTimes(1);
    expect(pipeline.deduper).toHaveBeenCalledTimes(1);
  });

  it("saves the extracted knowledge first, then merges repeats of stored claims after the save", async () => {
    const source = await upload(); const pipeline = deps();
    pipeline.duplicateGuard = vi.fn(async (_input, draft) => draft);
    let savedBeforeMerge = 0;
    pipeline.deduper = vi.fn(async () => {
      savedBeforeMerge = (await store.pg.query("select id from public.revisions where content like 'Workflow team%'")).rows.length;
    });
    const result = await reconcileUpload(pipeline, source.eventId, "knowledge");
    expect(result.status).toBe("applied");
    expect(pipeline.duplicateGuard).not.toHaveBeenCalled();
    expect(savedBeforeMerge).toBe(2);
    expect(result.workflow?.steps.map((step) => step.key).filter((key) => !key.startsWith("extract:")))
      .toEqual(expect.arrayContaining(["reconciliation-input", "extraction", "reconcile", "embeddings", "duplicates"]));
    expect(result.workflow?.steps.some((step) => step.key === "duplicate-guard")).toBe(false);
  });

  it("saves the knowledge in its own job, then writes the articles without repeating it", async () => {
    const source = await upload(); const pipeline = deps();
    const knowledge = await reconcileUpload(pipeline, source.eventId, "knowledge");
    expect(knowledge.error).toBeNull();
    expect(knowledge.status).toBe("applied");
    expect(knowledge.workflow && articlesPending(knowledge.workflow)).toBe(true);
    expect(workflowLabel(knowledge.workflow!)).toBe("Knowledge saved; articles not written yet");
    expect(knowledge.workflow?.steps.some((step) => ["expand", "plan", "pages"].includes(step.key))).toBe(false);
    expect(await store.pg.query("select id from public.pages where title='Workflow team'")).toHaveProperty("rows.length", 0);
    const articles = await reconcileUpload(pipeline, source.eventId, "articles");
    expect(articles.workflow?.state).toBe("complete");
    expect(await store.pg.query("select id from public.pages where title='Workflow team'")).toHaveProperty("rows.length", 1);
    expect(pipeline.draft).toHaveBeenCalledTimes(1);
    expect(pipeline.deduper).toHaveBeenCalledTimes(1);
  });

  // Each call in its own savepoint, so an expected raise (a cancel seen by a lease check)
  // does not abort the test's surrounding transaction the way it would not abort a real request
  function savepointDb(): DbRpc {
    return { async call<T>(fn: string, args?: RpcArgs) {
      await store.pg.exec("savepoint call");
      try { const result = await store.db.call<T>(fn, args); await store.pg.exec("release savepoint call"); return result; }
      catch (error) { await store.pg.exec("rollback to savepoint call"); throw error; }
    } };
  }

  it("cancels at the next check, keeps what was saved, refuses the automatic articles run and resumes on request", async () => {
    const source = await upload(); const pipeline = { ...deps(), db: savepointDb() };
    pipeline.entityDescriber = vi.fn(async () => {}).mockImplementationOnce(async () => {
      expect(await pipeline.db.call("cancel_upload_workflow", { p_event_id: source.eventId })).toBe("cancelling");
    });
    const cancelled = await reconcileUpload(pipeline, source.eventId, "knowledge");
    expect(cancelled.status).toBe("applied");
    expect(cancelled.workflow).toMatchObject({ state: "incomplete", error: "Processing was cancelled.", cancel_requested: true, progress: null });
    expect(cancelled.workflow?.steps.some((step) => step.state === "running")).toBe(false);
    // Repeats are merged right after the save, before the subjects are described
    expect(pipeline.deduper).toHaveBeenCalledTimes(1);
    expect(pipeline.hierarchyOrganizer).not.toHaveBeenCalled();
    const continued = await reconcileUpload(pipeline, source.eventId, "articles", true);
    expect(continued.workflow?.state).toBe("incomplete");
    expect(pipeline.hierarchyOrganizer).not.toHaveBeenCalled();
    const resumed = await reconcileUpload(pipeline, source.eventId);
    expect(resumed.workflow).toMatchObject({ state: "complete", error: null, cancel_requested: false });
    expect(pipeline.draft).toHaveBeenCalledTimes(1);
    // The interrupted role runs again; the committed knowledge is not extracted again
    expect(pipeline.entityDescriber).toHaveBeenCalledTimes(2);
    expect(pipeline.deduper).toHaveBeenCalledTimes(1);
  });

  it("cancels a run nobody is working on straight away", async () => {
    const source = await upload();
    expect(await store.db.call("cancel_upload_workflow", { p_event_id: source.eventId })).toBe("cancelled");
    const [workflow] = await store.db.call<{ state: string; error: string }[]>("read_upload_workflows", { p_event_ids: [source.eventId] });
    expect(workflow).toMatchObject({ state: "incomplete", error: "Processing was cancelled." });
  });

  it("reports live progress while a role runs and clears it on release", async () => {
    const source = await upload(); const pipeline = deps();
    let seen: unknown;
    pipeline.entityDescriber = vi.fn(async () => {
      await reportUploadProgress({ step: "describe", done: 1, total: 3 });
      seen = (await store.db.call<{ progress: unknown }[]>("read_upload_workflows", { p_event_ids: [source.eventId] }))[0]?.progress;
    });
    const result = await reconcileUpload(pipeline, source.eventId);
    expect(seen).toEqual({ step: "describe", done: 1, total: 3 });
    expect(result.workflow?.progress).toBeNull();
  });

  it("resumes a failed editorial reviewer without rewriting already saved page lines", async () => {
    const source = await upload(); const pipeline = deps();
    pipeline.writer.reviewSections = vi.fn().mockRejectedValueOnce(new Error("Reviewer unavailable")).mockResolvedValue(undefined);
    const first = await reconcileUpload(pipeline, source.eventId);
    expect(first.error).toContain("Reviewer unavailable");
    const before = await count("line_revisions");
    const second = await reconcileUpload(pipeline, source.eventId);
    expect(second.workflow?.state).toBe("complete");
    expect(await count("line_revisions")).toBe(before);
    expect(pipeline.draft).toHaveBeenCalledTimes(1);
    expect(pipeline.writer.reviewSections).toHaveBeenCalled();
  });

  it("does not lose the approval wakeup when it races with the original request pausing", async () => {
    const source = await upload(); const pipeline = deps(true);
    await reconcileUpload(pipeline, source.eventId);
    const exception = (await store.pg.query<{ id: string }>("select x.id from public.exceptions x join public.actions a on a.id=x.action_id join public.change_sets c on c.id=a.change_set_id where c.event_id=$1 and x.reason='root_domain_approval'", [source.eventId])).rows[0]!;
    // Simulate the owner still running while the final approval arrives.
    await store.pg.query("update public.upload_workflows set state='running', token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where event_id=$1", [source.eventId]);
    const owner = (await store.pg.query<{ token: string }>("select token from public.upload_workflows where event_id=$1", [source.eventId])).rows[0]!;
    await resolveException(store.db, { exceptionId: exception.id, accept: true, note: null });
    expect(await store.db.call("claim_upload_workflow", { p_event_id: source.eventId })).toEqual({ claimed: false });
    expect(await store.db.call("release_upload_workflow", { p_event_id: source.eventId, p_token: owner.token, p_state: "waiting" })).toBe(true);
    expect((await reconcileUpload(pipeline, source.eventId)).workflow?.state).toBe("complete");
  });

  it.each(["root-domain-approval", "external-source-approval", "archived-upload-status", "page-review", "role-instructions"])("preserves existing %s database policies", async (name) => {
    if (name === "archived-upload-status") {
      const source = await upload();
      await store.pg.query("update public.sources set archived_at=now(),archive_reason='test fixture' where id=$1", [source.sourceId]);
    }
    // Existing SQL checks run in this suite's rollback transaction.
    const sql = (await readFile(resolve(`test/db/${name}.sql`), "utf8"))
      .replace(/^\s*(begin|rollback);\s*$/gim, "");
    await store.pg.exec(sql);
  });
});
