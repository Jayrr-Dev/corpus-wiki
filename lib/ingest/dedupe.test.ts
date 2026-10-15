import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { DbRpc } from "@/lib/db/rpc";
import { chatJson } from "@/lib/ai/chat";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import { dedupeCluster, planDedupeClusters } from "./dedupe";

vi.mock("@/lib/ai/chat", () => ({ chatJson: vi.fn() }));
vi.mock("@/lib/change-control", () => ({ submitChangeSet: vi.fn(), commitChangeSet: vi.fn() }));

function store(count = 2) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `u${i}`, current_revision_id: `r${i}`, kind: "fact",
    epistemic_status: "established", created_at: "2026-10-15T00:00:00Z",
  }));
  const revisions = rows.map((row, i) => ({
    id: row.current_revision_id,
    content: i === 0 || i === count - 1 ? "Safety meetings" : `Topic ${i}`,
    passage_ids: [`p${i}`],
  }));
  const ranges: number[] = [];
  const client = {
    from: (table: string) => ({
      select: () => table === "units" ? {
        is: () => {
          const query = {
            order: () => query,
            range: async (from: number, to: number) => {
              ranges.push(from);
              return { data: rows.slice(from, to + 1), error: null };
            },
          };
          return query;
        },
      } : {
        in: async (_: string, ids: string[]) => ({ data: revisions.filter((r) => ids.includes(r.id)), error: null }),
      },
    }),
  } as unknown as AdminSupabase;
  return { client, ranges };
}

beforeEach(() => {
  vi.mocked(chatJson).mockResolvedValue({
    value: { groups: [{ keep: "U1", duplicates: ["U2"], content: null, reason: "Same claim" }] },
    model: "test", tokensIn: 10, tokensOut: 10,
  });
  vi.mocked(submitChangeSet).mockResolvedValue({ changeSetId: "change", eventId: "event" });
  vi.mocked(commitChangeSet).mockResolvedValue({
    changeSetId: "change", status: "applied", applied: 1, exceptions: 0, rejected: 0, eventStatus: "applied",
  });
});

describe("duplicate cleanup", () => {
  it("reads candidates beyond the first 1,000 rows", async () => {
    const { client, ranges } = store(1001);
    expect(await planDedupeClusters(client)).toEqual([["u0", "u1000"]]);
    expect(ranges).toEqual([0, 1000]);
  });

  it("applies explicit cleanup as a person-requested edit", async () => {
    const result = await dedupeCluster({ db: {} as DbRpc, client: store().client, settings: { apiKey: "test" } }, ["u0", "u1"], "apply");
    expect(submitChangeSet).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ actor: "person" }), expect.anything());
    expect(result).toMatchObject({ removed: 1, exceptions: 0 });
  });

  it("keeps background deduplication on the review path", async () => {
    await dedupeCluster({ db: {} as DbRpc, client: store().client, settings: { apiKey: "test" } }, ["u0", "u1"]);
    expect(submitChangeSet).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ actor: "ai" }), expect.anything());
  });

  it("does not report a failed commit as successful cleanup", async () => {
    vi.mocked(commitChangeSet).mockResolvedValue({
      changeSetId: "change", status: "rejected", applied: 0, exceptions: 0, rejected: 1, eventStatus: "applied",
    });
    await expect(dedupeCluster({ db: {} as DbRpc, client: store().client, settings: { apiKey: "test" } }, ["u0", "u1"], "apply")).rejects.toThrow("could not apply");
  });
});
