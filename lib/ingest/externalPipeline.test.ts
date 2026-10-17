import { expect, it, vi } from "vitest";
import { reconcileExternalUpload, type PipelineDeps } from "./pipeline";

it("records failure instead of committing a successful empty external extraction", async () => {
  const call = vi.fn(async (name: string) => {
    if (name === "reconciliation_input") return {
      source: { id: "source", title: "Company", sourceDate: "2026-10-16" },
      passages: [], existingUnits: [], entities: [], domainPaths: ["Stakeholders"],
    };
    return null;
  });
  const deps = {
    db: { call },
    reconciler: { draftChangeSet: vi.fn(async () => ({ summary: "Company facts", actions: [],
      trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null } })) },
  } as unknown as PipelineDeps;
  await expect(reconcileExternalUpload(deps, "event", {
    article: "Company", section: "Overview", note: "Company facts", referenceDomainPaths: ["Stakeholders"],
  })).rejects.toThrow("No knowledge was extracted into an allowed reference topic");
  expect(call).toHaveBeenLastCalledWith("set_event_status", expect.objectContaining({ p_event_id: "event", p_status: "failed" }));
  expect(call.mock.calls.some(([name]) => name === "submit_change_set")).toBe(false);
});
