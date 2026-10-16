"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorNote, TextLink } from "@/app/(app)/_components/bits";
import { RetryUploadButton } from "@/app/(app)/upload/RetryUploadButton";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { canResumeUpload, workflowLabel, type UploadWorkflow } from "@/lib/ingest/workflowTypes";

export function useUploadWorkflows(eventIds: string[]) {
  const ids = [...new Set(eventIds)].sort();
  return useQuery({
    queryKey: ["table", "upload_workflows", ids],
    queryFn: async () => {
      // Read independently of the long-running Server Action queue.
      const { data, error } = await getBrowserSupabase().rpc("read_upload_workflows", { p_event_ids: ids });
      if (error) throw error;
      return data as unknown as UploadWorkflow[];
    },
    enabled: ids.length > 0,
    refetchInterval: (query) => query.state.data?.every((run) => run.state === "complete") ? false : 3000,
  });
}

const LABELS: Record<string, string> = {
  reconcile: "Checking knowledge", "reconciliation-input": "Reading evidence", extraction: "Extracting knowledge",
  "duplicate-guard": "Comparing existing claims", embeddings: "Indexing knowledge", describe: "Describing subjects",
  expand: "Expanding definitions", plan: "Planning pages", pages: "Updating and reviewing pages",
  hierarchy: "Organizing topics", duplicates: "Checking duplicates", "settle-pages": "Checking final page updates",
};

export function UploadWorkflowStatus({ eventId, allowRetry = true, legacyStatus }: { eventId: string; allowRetry?: boolean; legacyStatus?: string }) {
  const query = useUploadWorkflows([eventId]);
  const workflow = query.data?.[0];
  if (query.error) return <ErrorNote error="Processing progress could not be loaded. Refresh to try again." />;
  if (!workflow) return legacyStatus ? <div className="flex flex-col gap-2"><span>{legacyStatus}</span>{!query.isPending && allowRetry && legacyStatus === "failed" ? <RetryUploadButton eventId={eventId} /> : null}</div> : null;
  const failed = workflow.steps.filter((step) => step.state === "failed" && !step.key.startsWith("extract:"));
  const current = workflow.steps.filter((step) => step.state === "running").at(-1);
  return (
    <div className="flex flex-col gap-2 text-sm" aria-live="polite">
      <p>{workflowLabel(workflow)}{current && workflow.state === "running" && !canResumeUpload(workflow) ? ` · ${LABELS[current.key] ?? "Reading a document section"}…` : ""}</p>
      {workflow.error ? <ErrorNote error={workflow.error} /> : null}
      {failed.length ? <ul className="space-y-1">{failed.map((step) => <li key={step.key}><ErrorNote error={`${LABELS[step.key] ?? "Document processing"}: ${step.error}`} /></li>)}</ul> : null}
      {workflow.waiting ? <TextLink href="/exceptions">Review pending decisions</TextLink> : null}
      {allowRetry && canResumeUpload(workflow) ? <RetryUploadButton eventId={eventId} /> : null}
    </div>
  );
}
