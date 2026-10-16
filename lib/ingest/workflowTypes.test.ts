import { afterEach, describe, expect, it, vi } from "vitest";
import { canResumeUpload, workflowLabel, type UploadWorkflow } from "./workflowTypes";

const run = (patch: Partial<UploadWorkflow> = {}): UploadWorkflow => ({
  event_id: "event", state: "incomplete", change_set_id: "change", waiting: false, lease_until: null, steps: [], ...patch,
});
afterEach(() => vi.useRealTimers());
describe("upload progress across screens", () => {
  it("allows unfinished applied knowledge to resume, but not approvals or complete runs", () => {
    expect(canResumeUpload(run())).toBe(true);
    expect(canResumeUpload(run({ waiting: true, state: "waiting" }))).toBe(false);
    expect(canResumeUpload(run({ state: "complete" }))).toBe(false);
    expect(workflowLabel(run({ waiting: true }))).toBe("Awaiting approval");
  });
  it("exposes recovery only after a running owner's lease expires", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    expect(canResumeUpload(run({ state: "running", lease_until: "2026-10-16T12:01:00Z" }))).toBe(false);
    expect(canResumeUpload(run({ state: "running", lease_until: "2026-10-16T11:59:00Z" }))).toBe(true);
  });
});
