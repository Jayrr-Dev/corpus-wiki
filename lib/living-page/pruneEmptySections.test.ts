import { expect, it, vi } from "vitest";
import { pruneEmptySections } from "./pruneEmptySections";
import type { DbRpc } from "@/lib/db/rpc";

it("retires empty scaffolding, preserves prose and handwritten blanks, and records undoable actions", async () => {
  const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "read_section_state") return { lines: args?.p_section_id === "empty" ? [] : args?.p_section_id === "manual" ? [{ author: "person", content: "" }] : [{ author: "ai", content: "Saved prose" }] };
    if (name === "submit_change_set") return { changeSetId: "cleanup" };
    return { status: "applied" };
  });
  expect(await pruneEmptySections({ call } as DbRpc, ["empty", "manual", "written"])).toBe(1);
  const submitted = call.mock.calls.find(([name]) => name === "submit_change_set")![1]!;
  expect(submitted.p_actions).toEqual([expect.objectContaining({ type: "retire_section", targetId: "empty" })]);
  expect(call).toHaveBeenCalledWith("commit_change_set", { p_change_set_id: "cleanup" });
});
