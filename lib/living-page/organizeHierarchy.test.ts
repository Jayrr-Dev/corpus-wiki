import { describe, expect, it, vi } from "vitest";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { organizeExistingEntityContext } from "./organizeHierarchy";

describe("entity hierarchy root creation", () => {
  const client = (exists: boolean) => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: exists ? [{ id: "root" }] : [], error: null }) };
    return { from: (table: string) => table === "entities" ? { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) } : query } as unknown as AdminSupabase;
  };
  it("does not manufacture a root for a newly recognized company or product", async () => {
    const db = { call: vi.fn() };
    await organizeExistingEntityContext(db, client(false), "vendor");
    expect(db.call).not.toHaveBeenCalled();
  });
  it("continues maintaining established entity contexts", async () => {
    const db = { call: vi.fn() };
    await organizeExistingEntityContext(db, client(true), "utilitek");
    expect(db.call).toHaveBeenCalledWith("organize_entity_context", { p_entity_id: "utilitek" });
  });
});
