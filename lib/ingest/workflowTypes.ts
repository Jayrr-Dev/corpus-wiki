export type UploadWorkflowState = "pending" | "running" | "waiting" | "complete" | "incomplete";
export type UploadWorkflow = {
  event_id: string;
  state: UploadWorkflowState;
  lease_until: string | null;
  change_set_id: string | null;
  error?: string | null;
  steps: { key: string; state: "running" | "succeeded" | "failed"; error: string | null; attempts: number }[];
  waiting: boolean;
};

export function canResumeUpload(workflow: UploadWorkflow): boolean {
  return !workflow.waiting && workflow.state !== "complete" &&
    (workflow.state !== "running" || !workflow.lease_until || Date.parse(workflow.lease_until) <= Date.now());
}

export function workflowLabel(workflow: UploadWorkflow): string {
  if (workflow.waiting) return "Awaiting approval";
  if (workflow.state === "complete") return "Processing complete";
  if (workflow.state === "running" && !canResumeUpload(workflow)) return "Processing";
  return workflow.change_set_id ? "Knowledge checked; work unfinished" : "Processing unfinished";
}
