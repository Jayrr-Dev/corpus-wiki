import { afterEach, describe, expect, it, vi } from "vitest";
import { canResumeUpload, failedWorkflowStages, uploadErrorMessage, workflowLabel, type UploadWorkflow } from "./workflowTypes";

const run = (patch: Partial<UploadWorkflow> = {}): UploadWorkflow => ({
  event_id: "event", state: "incomplete", change_set_id: "change", waiting: false, lease_until: null, steps: [], ...patch,
});
afterEach(() => vi.useRealTimers());
it("replaces legacy filing debates with a recovery message while retaining unrelated errors", () => {
  const diagnostic = "Filing into topics: Domain assignments need further review; no assignments were saved. Revise assignments: C402 is misplaced. Previous proposal: {secret diagnostics}";
  expect(uploadErrorMessage(diagnostic)).toBe("Topic filing paused for further review. Your extracted knowledge is saved. Resume to continue filing.");
  expect(uploadErrorMessage("Connection interrupted")).toBe("Connection interrupted");
  expect(uploadErrorMessage(null)).toBeNull();
});
describe("upload progress across screens", () => {
  it("allows unfinished applied knowledge to resume, but not approvals or complete runs", () => {
    expect(canResumeUpload(run())).toBe(true);
    expect(canResumeUpload(run({ waiting: true, state: "waiting" }))).toBe(false);
    expect(canResumeUpload(run({ state: "complete" }))).toBe(false);
    expect(workflowLabel(run({ waiting: true }))).toBe("Awaiting approval");
    expect(workflowLabel(run({ waiting: true, progress: { step: "root-approval", done: 25, total: 2013 } }))).toBe("Applying approved domains");
  });
  it("exposes recovery only after a running owner's lease expires", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    expect(canResumeUpload(run({ state: "running", lease_until: "2026-10-16T12:01:00Z" }))).toBe(false);
    expect(canResumeUpload(run({ state: "running", lease_until: "2026-10-16T11:59:00Z" }))).toBe(true);
  });
});

it("reports current failed stages while retaining recovered checkpoint failures only in history",()=>{
 const workflow:UploadWorkflow={event_id:"upload",state:"running",lease_until:null,change_set_id:null,waiting:false,steps:[
  {key:"name-duplicate-v2:old",state:"failed",error:"Invalid explanation",attempts:1},
  {key:"reconcile",state:"succeeded",error:null,attempts:2},
  {key:"place-v4:review:old",state:"failed",error:"Old proposal rejected",attempts:1},
  {key:"place",state:"running",error:null,attempts:2},
 ]};
 expect(failedWorkflowStages(workflow)).toEqual([]);
 workflow.steps[3]={...workflow.steps[3]!,state:"failed",error:"Current proposal needs correction"};
 expect(failedWorkflowStages(workflow).map(s=>s.error)).toEqual(["Current proposal needs correction"]);
 expect(workflow.steps.filter(s=>s.state==="failed")).toHaveLength(3);
});
