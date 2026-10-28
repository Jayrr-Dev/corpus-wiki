import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AgentSession } from "@/lib/agents/types";
import type { UploadWorkflow } from "@/lib/ingest/workflowTypes";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  withAgentSession: vi.fn((_session: unknown, run: () => Promise<unknown>) => run()),
  tables: {} as Record<string, unknown>,
  workflows: [] as unknown[],
  glossary: null as unknown,
  actions: {} as Record<string, Mock<(...args: unknown[]) => Promise<unknown>>>,
}));
const { action, actionModule } = vi.hoisted(() => {
  const action = (name: string) => (mocks.actions[name] ??= vi.fn(async () => ({ ok: true })));
  const actionModule = (...names: string[]) => Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => action(name)(...args)]));
  return { action, actionModule };
});

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/agents/session", () => ({ withAgentSession: mocks.withAgentSession }));
vi.mock("@/lib/glossary/storage", () => ({ readGlossaryView: async () => mocks.glossary }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => fakeClient() }));
vi.mock("@/lib/server-actions/upload", () => actionModule("startUpload", "startLinkUpload", "processUpload"));
vi.mock("@/lib/server-actions/pages", () => actionModule("createPage", "createSection", "forceCreateSection", "improveArticle", "refreshStaleSections", "renamePage", "renameSection", "updateArticle"));
vi.mock("@/lib/server-actions/knowledge", () => actionModule("answerException", "submitLineEdit", "undoChangeSet"));
vi.mock("@/lib/server-actions/sources", () => actionModule("applySourceKnowledge", "archiveSourceAction", "replaceSource", "restoreSourceAction"));
vi.mock("@/lib/server-actions/graphNodes", () => actionModule("moveGraphClaim", "organizeGraphSelection", "setGraphLinkRemoved"));
vi.mock("@/lib/server-actions/sourcer", () => actionModule("addExternalInfo"));
vi.mock("@/lib/server-actions/entities", () => actionModule("restoreEntityDescription"));
vi.mock("@/lib/server-actions/glossary", () => actionModule("changeGlossaryDefinition"));
vi.mock("@/lib/server-actions/assets", () => actionModule("setAssetDeleted"));

import { fileFromBase64, MAX_UPLOAD_BYTES, uploadPhase, writeTools } from "./write";

// A Supabase stand-in: every query on a table answers with mocks.tables[table]
function fakeClient() {
  const answer = (table: string) => ({ data: mocks.tables[table] ?? null, error: null });
  return {
    from(table: string) {
      const chain: Record<string | symbol, unknown> = new Proxy({}, {
        get(_target, key) {
          if (key === "then") return (resolve: (value: unknown) => unknown) => resolve(answer(table));
          if (key === "single" || key === "maybeSingle") return async () => {
            const { data } = answer(table);
            return { data: Array.isArray(data) ? data[0] ?? null : data, error: null };
          };
          return () => chain;
        },
      });
      return chain;
    },
    rpc: async () => ({ data: mocks.workflows, error: null }),
  };
}

const session = { key: { keyId: "k", name: "Claude", personId: "p", spaceId: "s", scopes: ["write"] }, spaceId: "s" } as AgentSession;
const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

function tool(name: string) {
  const found = writeTools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return found;
}
async function call(name: string, args: Record<string, unknown>) {
  const found = tool(name);
  return found.run(found.input.parse(args) as never, { session });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks.actions)) mock.mockReset().mockResolvedValue({ ok: true });
  mocks.tables = { pages: { slug: "travel-policy", entity_id: ID2 }, sections: { page_id: ID } };
  mocks.workflows = [];
  mocks.glossary = null;
});

describe("write tool definitions", () => {
  it("have unique names, the right scopes and annotations, and never declare space", () => {
    expect(new Set(writeTools.map((t) => t.name)).size).toBe(writeTools.length);
    for (const t of writeTools) {
      expect(t.scope).toBe(t.name === "get_upload_status" ? "read" : "write");
      expect(t.input.shape).not.toHaveProperty("space");
      expect(t.annotations.readOnlyHint ?? false).toBe(t.name === "get_upload_status");
    }
    const destructive = writeTools.filter((t) => t.annotations.destructiveHint).map((t) => t.name).sort();
    expect(destructive).toEqual(["replace_source_file", "rewrite_article", "set_claim_link_removed", "undo_change_set"]);
  });
});

describe("uploads", () => {
  it("adds a note as a Markdown file and answers before processing runs", async () => {
    action("startUpload").mockResolvedValue({ ok: true, kind: "started", sourceId: ID, eventId: ID2 });
    const result = await call("add_note", { text: "Travel is booked by HR.", title: "HR notes", sourceDate: "2026-10-01" });
    const form = action("startUpload").mock.calls[0]![0] as FormData;
    expect((form.get("file") as File).name).toBe("HR notes.md");
    expect(await (form.get("file") as File).text()).toBe("Travel is booked by HR.");
    expect(form.get("sourceDate")).toBe("2026-10-01");
    expect(result).toMatchObject({ status: "processing", eventId: ID2, sourceId: ID, href: `/sources/${ID}` });
    expect(action("processUpload")).not.toHaveBeenCalled();

    action("processUpload").mockResolvedValue({ ok: true, status: "applied" });
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.withAgentSession).toHaveBeenCalledWith(session, expect.any(Function));
    expect(action("processUpload")).toHaveBeenCalledWith(ID2);
  });

  it("does not process content seen before", async () => {
    action("startLinkUpload").mockResolvedValue({ ok: true, kind: "skipped", sourceId: ID });
    expect(await call("add_source_url", { url: "https://example.com/a", sourceDate: "2026-10-02" })).toMatchObject({ status: "skipped", sourceId: ID });
    expect(action("startLinkUpload")).toHaveBeenCalledWith("https://example.com/a", "2026-10-02");
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("turns a failed action into a thrown error", async () => {
    action("startLinkUpload").mockResolvedValue({ ok: false, error: "That page could not be read." });
    await expect(call("add_source_url", { url: "https://example.com/a" })).rejects.toThrow("That page could not be read.");
    expect(() => tool("add_source_url").input.parse({ url: "file:///etc/passwd" })).toThrow();
  });

  it("uploads base64 bytes with the type its extension names", async () => {
    action("startUpload").mockResolvedValue({ ok: true, kind: "started", sourceId: ID, eventId: ID2 });
    await call("upload_file", { fileName: "report.md", contentBase64: Buffer.from("# Report").toString("base64") });
    const file = (action("startUpload").mock.calls[0]![0] as FormData).get("file") as File;
    expect([file.name, file.type, await file.text()]).toEqual(["report.md", "text/markdown", "# Report"]);
  });

  it("refuses unknown types, empty files and files over the limit", () => {
    expect(() => fileFromBase64("tool.exe", "AAAA")).toThrow("can't be read");
    expect(() => fileFromBase64("a.pdf", "")).toThrow("empty");
    expect(() => fileFromBase64("a.pdf", Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString("base64"))).toThrow("3 MB");
  });

  it("replaces a source's file and follows the new upload", async () => {
    action("replaceSource").mockResolvedValue({ ok: true, kind: "started", sourceId: ID2, eventId: ID });
    const result = await call("replace_source_file", { sourceId: ID, fileName: "v2.txt", contentBase64: Buffer.from("new").toString("base64"), sourceDate: "2026-10-03" });
    const form = action("replaceSource").mock.calls[0]![0] as FormData;
    expect([form.get("sourceId"), form.get("sourceDate")]).toEqual([ID, "2026-10-03"]);
    expect(result).toMatchObject({ status: "processing", eventId: ID, replacedSourceId: ID });
    expect(mocks.after).toHaveBeenCalledOnce();
  });
});

describe("upload status", () => {
  const workflow = (patch: Partial<UploadWorkflow>): UploadWorkflow => ({ event_id: ID, state: "incomplete", lease_until: null, change_set_id: null, steps: [], waiting: false, ...patch });

  it("names five plain phases", () => {
    expect(uploadPhase("reconciling", null, 0)).toBe("processing");
    expect(uploadPhase("applied", workflow({ state: "running", lease_until: new Date(Date.now() + 60_000).toISOString() }), 0)).toBe("processing");
    expect(uploadPhase("applied", workflow({ waiting: true }), 0)).toBe("held_for_review");
    expect(uploadPhase("applied", workflow({ state: "complete" }), 2)).toBe("held_for_review");
    expect(uploadPhase("applied", workflow({ error: "Model failed" }), 0)).toBe("failed");
    expect(uploadPhase("failed", null, 0)).toBe("failed");
    expect(uploadPhase("applied", workflow({ state: "complete" }), 0)).toBe("applied");
    expect(uploadPhase("reverted", null, 0)).toBe("reverted");
  });

  it("reports what changed and what waits for review", async () => {
    mocks.tables = {
      shift_events: { id: ID, status: "applied", error: null, source_id: ID2, created_at: "t0", finished_at: "t1" },
      change_sets: [{ id: ID, status: "partly_applied", summary: "Added 2 claims", applied_at: "t1" }],
      actions: [{ id: "a1", type: "create_claim", outcome: "applied" }, { id: "a2", type: "create_claim", outcome: "applied" }, { id: "a3", type: "revise_claim", outcome: "exception" }],
      exceptions: [{ id: "x1", reason: "decision_conflict", note: null, created_at: "t1" }],
    };
    mocks.workflows = [workflow({ state: "complete" })];
    expect(await call("get_upload_status", { eventId: ID })).toMatchObject({
      phase: "held_for_review",
      label: "Applied",
      href: `/sources/${ID2}`,
      changes: [{ changeSetId: ID, summary: "Added 2 claims", href: `/changes/${ID}` }],
      appliedActions: { create_claim: 2 },
      heldForReview: [{ exceptionId: "x1", reason: "decision_conflict" }],
    });
  });

  it("refuses an event outside this Space", async () => {
    await expect(call("get_upload_status", { eventId: ID })).rejects.toThrow("No upload with that event ID");
  });
});

describe("articles and knowledge", () => {
  it("creates an article and writes it from instructions", async () => {
    action("createPage").mockResolvedValue({ ok: true, pageId: ID, slug: "travel" });
    action("updateArticle").mockResolvedValue({ ok: true, sections: 3 });
    expect(await call("create_article", { title: "Travel", entityId: ID2, instructions: "Cover booking" })).toEqual({ pageId: ID, slug: "travel", sections: 3, message: undefined, href: "/p/travel" });
    expect(action("createPage")).toHaveBeenCalledWith({ title: "Travel", entityId: ID2 });
    expect(action("updateArticle")).toHaveBeenCalledWith({ scope: "page", id: ID, note: "Cover booking" });
  });

  it("keeps the created article's link when writing it fails", async () => {
    action("createPage").mockResolvedValue({ ok: true, pageId: ID, slug: "travel" });
    action("updateArticle").mockResolvedValue({ ok: false, error: "No AI provider" });
    await expect(call("create_article", { title: "Travel", instructions: "x" })).rejects.toThrow("created at /p/travel, but writing it failed: No AI provider");
  });

  it("rewrites a section and links its article", async () => {
    action("updateArticle").mockResolvedValue({ ok: true, sections: 1 });
    expect(await call("rewrite_article", { scope: "section", id: ID2, instructions: "Shorter" })).toEqual({ sections: 1, href: "/p/travel-policy" });
    expect(action("updateArticle")).toHaveBeenCalledWith({ scope: "section", id: ID2, note: "Shorter" });
  });

  it("adds a section for the article's own entity by default", async () => {
    await call("create_section", { pageId: ID, title: "Steps", kind: "procedure" });
    expect(action("createSection")).toHaveBeenCalledWith({ pageId: ID, title: "Steps", entityId: ID2, kind: "procedure" });
  });

  it("maps line edits, claim moves, answers and undo", async () => {
    action("submitLineEdit").mockResolvedValue({ ok: true, changeSetId: ID, status: "applied", applied: 1, exceptions: 0 });
    expect(await call("edit_line", { lineId: ID2, content: "New text" })).toMatchObject({ changeSetId: ID, href: `/changes/${ID}` });
    expect(action("submitLineEdit")).toHaveBeenCalledWith(ID2, "New text");

    await call("move_claim", { unitId: ID, toDomainPath: "Policies/Travel" });
    expect(action("moveGraphClaim")).toHaveBeenCalledWith(ID, "", "Policies/Travel");
    await call("organize_claims", { unitIds: [ID], domainPath: "Policies", newName: "Travel" });
    expect(action("organizeGraphSelection")).toHaveBeenCalledWith([ID], "Policies", "Travel");

    await call("answer_exception", { exceptionId: ID, decision: "reject", note: "" });
    expect(action("answerException")).toHaveBeenCalledWith(ID, false, null);
    await call("answer_exception", { exceptionId: ID, decision: "accept", note: "Checked" });
    expect(action("answerException")).toHaveBeenLastCalledWith(ID, true, "Checked");

    action("undoChangeSet").mockResolvedValue({ ok: false, error: "Already reverted." });
    await expect(call("undo_change_set", { changeSetId: ID })).rejects.toThrow("Already reverted.");
  });

  it("maps source archive and restore", async () => {
    action("archiveSourceAction").mockResolvedValue({ ok: true, staleUnits: 4 });
    expect(await call("archive_source", { sourceId: ID, reason: "Out of date" })).toEqual({ staleUnits: 4, sourceId: ID, href: `/sources/${ID}` });
    expect(action("archiveSourceAction")).toHaveBeenCalledWith(ID, "Out of date");
    await call("restore_source", { sourceId: ID });
    expect(action("restoreSourceAction")).toHaveBeenCalledWith(ID);
    await call("restore_asset", { assetId: ID });
    expect(action("setAssetDeleted")).toHaveBeenCalledWith(ID, false);
  });

  it("changes a glossary definition by term, asking for a scope when the term has several", async () => {
    const entry = (scopeKey: string) => ({ term: "PPE", scopeKey, expansion: null, aliases: [], category: "acronym", definition: "Old", context: null, citations: [] });
    mocks.glossary = { status: "ready", entries: [entry("general"), entry("lab")] };
    await expect(call("change_glossary_definition", { term: "ppe", definition: "Protective gear." })).rejects.toThrow("general, lab");
    await call("change_glossary_definition", { term: "PPE", definition: "Protective gear.", scopeKey: "lab" });
    expect(action("changeGlossaryDefinition")).toHaveBeenCalledWith(entry("lab"), "Protective gear.");
  });
});
