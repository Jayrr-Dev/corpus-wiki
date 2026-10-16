import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentStep } from "./agentTools";
import { executeAgentTool } from "./agent";
import type { DbRpc } from "@/lib/db/rpc";
import type { Embedder } from "@/lib/ai/embeddings";

const mocks = vi.hoisted(() => ({ client: { from: vi.fn() }, createPage: vi.fn(), updateArticle: vi.fn(), startLinkUpload: vi.fn(), processUpload: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => mocks.client }));
vi.mock("@/lib/server-actions/pages", () => ({ createPage: mocks.createPage, updateArticle: mocks.updateArticle }));
vi.mock("@/lib/server-actions/upload", () => ({ startLinkUpload: mocks.startLinkUpload, processUpload: mocks.processUpload }));
vi.mock("./retrieve", () => ({ retrieve: vi.fn() }));
const deps = { db: {} as DbRpc, embedder: {} as Embedder, userText: "Import https://example.com/article" };
const source = { name: "add_source" as const, url: "https://example.com/article", sourceDate: "2026-10-16" };

beforeEach(() => vi.clearAllMocks());
describe("Ask agent tools", () => {
  it("rejects unsupported operations and malformed arguments", () => {
    expect(agentStep.safeParse({ message: "Delete", tool: { name: "delete_all" } }).success).toBe(false);
    expect(agentStep.safeParse({ message: "Add", tool: { ...source, url: "file:///private" } }).success).toBe(false);
    expect(agentStep.safeParse({ message: "Update", tool: { name: "update_article", pageId: "invented", instructions: "Rewrite" } }).success).toBe(false);
  });
  it("blocks importing a link that appears only in retrieved evidence", async () => {
    await expect(executeAgentTool(source, { ...deps, userText: "Summarize my sources" })).rejects.toThrow("exact source link");
    expect(mocks.startLinkUpload).not.toHaveBeenCalled();
  });
  it("processes a new source and preserves a held workflow status", async () => {
    mocks.startLinkUpload.mockResolvedValue({ ok: true, kind: "started", sourceId: "source", eventId: "event" });
    mocks.processUpload.mockResolvedValue({ ok: true, status: "held", changeSetId: "change", error: null });
    expect(await executeAgentTool(source, deps)).toMatchObject({ status: "held", href: "/sources/source" });
    expect(mocks.processUpload).toHaveBeenCalledWith("event");
  });
  it("does not process duplicate or failed source imports", async () => {
    mocks.startLinkUpload.mockResolvedValue({ ok: true, kind: "skipped", sourceId: "existing" });
    expect(await executeAgentTool(source, deps)).toMatchObject({ kind: "skipped" });
    mocks.startLinkUpload.mockResolvedValue({ ok: false, error: "Not readable" });
    expect(await executeAgentTool(source, deps)).toEqual({ ok: false, error: "Not readable" });
    expect(mocks.processUpload).not.toHaveBeenCalled();
  });
  it("does not write an article outside the selected entity", async () => {
    await expect(executeAgentTool({ name: "create_article", title: "Article", entityId: "other", instructions: "" }, { ...deps, entityId: "selected" })).rejects.toThrow("chat context");
    expect(mocks.createPage).not.toHaveBeenCalled();
  });
  it("only proposes an exception decision without resolving it", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: "exception", reason: "conflict" }, error: null }) };
    mocks.client.from.mockReturnValue(query);
    const decision = { name: "resolve_exception" as const, exceptionId: "exception", accept: false, note: "Evidence conflicts" };
    expect(await executeAgentTool(decision, deps)).toMatchObject({ confirmationRequired: true, decision });
  });
});
