import { describe, expect, it, vi } from "vitest";
import { CONTEXT_UPDATE_REQUIRED, requireContextStorage } from "./contextReadiness";
import type { AdminSupabase } from "@/lib/supabase/admin";

function client(error: {code:string;message:string} | null) {
  return { from: vi.fn(() => ({ select: vi.fn(() => ({ limit: vi.fn(async () => ({ error })) })) })) } as unknown as AdminSupabase;
}
describe("context storage readiness", () => {
  it("stops writes against a schema that would silently ignore context", async () => {
    await expect(requireContextStorage(client({code:"42703",message:"column knowledge_context does not exist"}))).rejects.toThrow(CONTEXT_UPDATE_REQUIRED);
  });
  it("allows an installed context schema", async () => {
    await expect(requireContextStorage(client(null))).resolves.toBeUndefined();
  });
  it("does not mislabel a connection failure as a missing migration", async () => {
    await expect(requireContextStorage(client({code:"08006",message:"Connection failed"}))).rejects.toThrow("Connection failed");
  });
});
