import { beforeEach, expect, it, vi } from "vitest";
import { expandEventKnowledge } from "./knowledgeExpansion";
import { loadArticleKnowledge, NoArticleClaimsError } from "./articlePlanner";
import { chatJson } from "@/lib/ai/chat";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
vi.mock("./articlePlanner", async original => ({ ...await original<typeof import("./articlePlanner")>(), loadArticleKnowledge: vi.fn() }));
vi.mock("./organizeHierarchy", () => ({ organizeExistingEntityContext: vi.fn() }));
vi.mock("@/lib/ai/chat", async original => ({ ...await original<typeof import("@/lib/ai/chat")>(), chatJson: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
function deps() {
  const db = { call: vi.fn().mockResolvedValue([{ entityId: "empty", type: "person" }, { entityId: "next", type: "organization" }]) } as DbRpc;
  return { db, client: {} as AdminSupabase, settings: { apiKey: "test" }, writer: { name: "test", reviseSection: vi.fn() } };
}
it("skips referenced entities without claims and continues to the next candidate without AI calls", async () => {
  vi.mocked(loadArticleKnowledge).mockRejectedValue(new NoArticleClaimsError());
  await expect(expandEventKnowledge(deps(), "upload")).resolves.toBeUndefined();
  expect(vi.mocked(loadArticleKnowledge).mock.calls.map(call => call[1])).toEqual(["empty", "next"]);
  expect(chatJson).not.toHaveBeenCalled();
});
it("does not swallow a database or provider failure as empty evidence", async () => {
  vi.mocked(loadArticleKnowledge).mockRejectedValue(new Error("Database unavailable"));
  await expect(expandEventKnowledge(deps(), "upload")).rejects.toThrow("Database unavailable");
  expect(loadArticleKnowledge).toHaveBeenCalledTimes(1);
});
