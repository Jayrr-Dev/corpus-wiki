import { expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { proposePages } from "./proposePages";

it.each(["rejected", "partly_applied"])("does not checkpoint %s page proposals as successful", async (status) => {
  const db: DbRpc = { call: vi.fn(async (name: string) => {
    if (name === "page_candidates") return [{ entityId: "entity", type: "team", key: "team", name: "Team", claimCount: 2, kinds: ["fact"], page: null }];
    if (name === "submit_change_set") return { changeSetId: "proposal" };
    return { status, applied: status === "partly_applied" ? 1 : 0, rejected: 1, exceptions: 0 };
  }) as DbRpc["call"] };
  await expect(proposePages(db, "upload")).rejects.toThrow("Page planning was not fully applied");
});
