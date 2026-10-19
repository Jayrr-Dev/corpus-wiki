import { beforeEach, expect, it, vi } from "vitest";
import { chatJson } from "@/lib/ai/chat";
import { selectArticleScope } from "./articleScope";
import type { SectionUnit } from "./types";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
vi.mock("@/lib/ai/chat", async original => ({ ...await original<typeof import("@/lib/ai/chat")>(), chatJson: vi.fn() }));
const unit = (unitId: string, memberOf?: string): SectionUnit => ({ unitId, revisionId: unitId, content: unitId, kind: "fact", epistemicStatus: "supported", ...(memberOf ? { memberOf } : {}) });
beforeEach(() => vi.resetAllMocks());
it("excludes a composite and every member together before lossless outline routing", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { groups: [{ ref: "G1", decision: "in_scope", reason: "Definition" }, { ref: "G2", decision: "outside_scope", reason: "Detailed types excluded" }] }, tokensIn: 7, tokensOut: 2, model: "test" });
  const result = await selectArticleScope({ apiKey: "test" }, "Overview", "No type details", [unit("definition"), unit("types"), unit("one", "types"), unit("two", "types")]);
  expect(result).toEqual({ excludedIds: ["types", "one", "two"], tokensIn: 7, tokensOut: 2 });
  const sent = JSON.parse(String(vi.mocked(chatJson).mock.calls[0]![1].messages[1]!.content));
  expect(sent.groups[1].claims.map((claim: { id: string }) => claim.id)).toEqual(["types", "one", "two"]);
});
it("rejects duplicate or missing scope decisions rather than silently dropping knowledge", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { groups: [{ ref: "G1", decision: "in_scope", reason: "ok" }, { ref: "G1", decision: "outside_scope", reason: "bad" }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  await expect(selectArticleScope({ apiKey: "test" }, "Subject", "Scope", [unit("a"), unit("b")])).rejects.toThrow("every evidence group exactly once");
});
it("does not call the model for an unscoped article", async () => {
  expect(await selectArticleScope({ apiKey: "test" }, "Subject", null, [unit("a")])).toMatchObject({ excludedIds: [] });
  expect(chatJson).not.toHaveBeenCalled();
});
it("reuses its durable scope decisions on resume without another paid call", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { groups: [{ ref: "G1", decision: "outside_scope", reason: "Other article" }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  const saved = new Map<string, unknown>();
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    if (name === "start_upload_step") return { done: saved.has(String(args.p_key)), output: saved.get(String(args.p_key)) } as T;
    if (name === "finish_upload_step") saved.set(String(args.p_key), args.p_output);
    return null as T;
  } };
  const run = () => uploadExecution.run({ db, eventId: "upload", token: "lease" }, () => selectArticleScope({ apiKey: "test" }, "Overview", "No details", [unit("details")]));
  expect(await run()).toEqual(await run());
  expect(chatJson).toHaveBeenCalledTimes(1);
});
