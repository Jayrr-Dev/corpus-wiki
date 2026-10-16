import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { portablePostgres } from "@/test/db/portablePostgres";
import { resolveException, submitChangeSet } from "@/lib/change-control";
import type { DraftChangeSet, ReconciliationInput } from "@/lib/ai/types";
import { FakeSectionWriter } from "@/lib/living-page";
import { reconcileUpload, recordUpload, finishApprovedUpload, type PipelineDeps } from "./pipeline";
import { uploadExecution, workflowWrite } from "./workflowContext";
import { splitIntoPassages } from "./passages";
import { articlesPending, workflowLabel } from "./workflowTypes";
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
  function deps(root = false): PipelineDeps & { draft: ReturnType<typeof vi.fn> } {
    const draft = vi.fn(async (input: ReconciliationInput): Promise<DraftChangeSet> => ({
      summary: "Workflow training", trace: { modelVersion: "fixture", promptVersion: "v1", tokensIn: 10, tokensOut: 10 },
      actions: [
        ...(root ? [{ type: "create_domain" as const, targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
          input: { name: "Workflow team", path: "Workflow team", parentPath: null } }] : []),
        { type: "create_entity", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
          input: { type: "team", key: "workflow-team", name: "Workflow team", aliases: [] } },
        ...["Workflow team trains monthly.", "Workflow team retains training records."].map((content) => ({
          type: "add_claim" as const, targetId: null, expectedRevisionId: null, passageIds: [input.passages[0]!.id], speechAct: "stated" as const,
          input: { content, kind: "fact" as const, epistemicStatus: "supported" as const, validFrom: input.source.sourceDate,
            entities: [{ type: "team", key: "workflow-team", role: "subject" as const }], domainPaths: root ? ["Workflow team"] : [] },
        })),
      ],
    }));
    return { db: store.db, reconciler: { name: "fixture", draftChangeSet: draft }, writer: new FakeSectionWriter(), draft,
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
    const exception = (await store.pg.query<{ id: string }>("select x.id from public.exceptions x join public.actions a on a.id=x.action_id where a.change_set_id=$1 and x.reason='root_domain_approval'", [first.changeSetId])).rows[0]!;
    await resolveException(store.db, { exceptionId: exception.id, accept: true, note: null });
    await finishApprovedUpload(pipeline, source.eventId);
    const final = await reconcileUpload(pipeline, source.eventId);
    expect(final.workflow?.state).toBe("complete");
    expect(pipeline.draft).toHaveBeenCalledTimes(1);
    expect(pipeline.entityDescriber).toHaveBeenCalledTimes(1);
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
      has_function_privilege('authenticated','public.claim_upload_workflow(uuid)','execute') rpc,
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
