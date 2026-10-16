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

// TWO JOBS. Knowledge: the claims are extracted, committed and cleaned. Articles: pages are
// planned and written once from that finished knowledge. Each job is its own request, so a
// slow page write never takes the saved knowledge down with it.
export type UploadJob = "knowledge" | "articles";

// The cleanup roles all finish before any page is written, so pages are built once
export const KNOWLEDGE_STAGES = ["embeddings", "describe", "duplicates", "hierarchy", "glossary"] as const;
export const ARTICLE_STAGES = ["expand", "plan", "pages"] as const;

// The knowledge job finished cleanly and the articles have not been written yet
export function articlesPending(workflow: UploadWorkflow): boolean {
  const succeeded = new Set(workflow.steps.filter((step) => step.state === "succeeded").map((step) => step.key));
  return workflow.state === "incomplete" && !workflow.error && !workflow.waiting &&
    ["reconcile", ...KNOWLEDGE_STAGES].every((key) => succeeded.has(key)) &&
    !workflow.steps.some((step) => step.state === "failed" && (ARTICLE_STAGES as readonly string[]).includes(step.key));
}

export function canResumeUpload(workflow: UploadWorkflow): boolean {
  return !workflow.waiting && workflow.state !== "complete" &&
    (workflow.state !== "running" || !workflow.lease_until || Date.parse(workflow.lease_until) <= Date.now());
}

export function workflowLabel(workflow: UploadWorkflow): string {
  if (workflow.waiting) return "Awaiting approval";
  if (workflow.state === "complete") return "Processing complete";
  if (workflow.state === "running" && !canResumeUpload(workflow)) return "Processing";
  if (articlesPending(workflow)) return "Knowledge saved; articles not written yet";
  return workflow.change_set_id ? "Knowledge checked; work unfinished" : "Processing unfinished";
}
