export type UploadWorkflowState = "pending" | "running" | "waiting" | "complete" | "incomplete";
export type UploadWorkflow = {
  event_id: string;
  state: UploadWorkflowState;
  lease_until: string | null;
  change_set_id: string | null;
  error?: string | null;
  steps: { key: string; state: "running" | "succeeded" | "failed"; error: string | null; attempts: number }[];
  waiting: boolean;
  cancel_requested?: boolean;
  // How far the current long role has got (batches read, sections written)
  progress?: { step: string; done: number; total: number } | null;
};

// The run holds a live lease: something is working on it right now
export function isRunning(workflow: UploadWorkflow): boolean {
  return workflow.state === "running" && !!workflow.lease_until && Date.parse(workflow.lease_until) > Date.now();
}

// Cancel is offered while a run works, and while saved knowledge waits for its articles
export function canCancelUpload(workflow: UploadWorkflow): boolean {
  return !workflow.cancel_requested && (isRunning(workflow) || articlesPending(workflow));
}

// TWO JOBS. Knowledge: the claims are extracted, committed and cleaned. Articles: pages are
// planned and written once from that finished knowledge. Each job is its own request, so a
// slow page write never takes the saved knowledge down with it.
export type UploadJob = "knowledge" | "articles";

// After the save: index the new claims, merge their repeats of stored claims (by meaning,
// so it needs the vectors), merge duplicate entities and retire unused ones ("tidy"), file
// what is left into topics in one view of the whole file ("place"; a new root waits for
// approval here), then describe, write stakeholder cards ("profiles") and organize. All of it
// finishes before any page is written, so pages are built once from cleaned, filed knowledge.
export const KNOWLEDGE_STAGES = ["embeddings", "duplicates", "tidy", "place", "describe", "profiles", "hierarchy", "glossary"] as const;
export const ARTICLE_STAGES = ["expand", "plan", "pages", "curate"] as const;

// Every knowledge stage is saved and the articles are still unfinished (never run, or failed)
export function knowledgeSaved(workflow: UploadWorkflow): boolean {
  const succeeded = new Set(workflow.steps.filter((step) => step.state === "succeeded").map((step) => step.key));
  return workflow.state === "incomplete" && !workflow.waiting && ["reconcile", ...KNOWLEDGE_STAGES].every((key) => succeeded.has(key));
}

// The knowledge job finished cleanly and the articles have not been written yet
export function articlesPending(workflow: UploadWorkflow): boolean {
  return knowledgeSaved(workflow) && !workflow.error &&
    !workflow.steps.some((step) => step.state === "failed" && (ARTICLE_STAGES as readonly string[]).includes(step.key));
}

export function canResumeUpload(workflow: UploadWorkflow): boolean {
  return !workflow.waiting && workflow.state !== "complete" &&
    (workflow.state !== "running" || !workflow.lease_until || Date.parse(workflow.lease_until) <= Date.now());
}

export function workflowLabel(workflow: UploadWorkflow): string {
  if (workflow.waiting) return "Awaiting approval";
  // Complete with an error: processing was closed early (its file was removed). A clean finish
  // reads "Applied", the same as an older upload that has no workflow record
  if (workflow.state === "complete") return workflow.error ? "Processing stopped" : "Applied";
  if (isRunning(workflow)) return workflow.cancel_requested ? "Cancelling" : "Processing";
  if (articlesPending(workflow)) return "Knowledge saved; articles not written yet";
  return workflow.change_set_id ? "Knowledge checked; work unfinished" : "Processing unfinished";
}
