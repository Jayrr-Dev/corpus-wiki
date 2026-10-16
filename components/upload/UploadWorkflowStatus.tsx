"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, LoaderCircle, Minus, X } from "lucide-react";
import { useState } from "react";
import { ErrorNote, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { EVENT_TONE, type Tone } from "@/app/(app)/_lib/tone";
import { RetryUploadButton } from "@/app/(app)/upload/RetryUploadButton";
import { Button } from "@/components/ui/button";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { ARTICLE_STAGES, KNOWLEDGE_STAGES, canCancelUpload, canResumeUpload, isRunning, workflowLabel, type UploadWorkflow } from "@/lib/ingest/workflowTypes";
import { cn } from "@/lib/utils";

// How often the status is read while a run works, and while it waits for a resume
const RUNNING_POLL_MS = 1500;
const IDLE_POLL_MS = 3000;

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
    refetchInterval: (query) => {
      const runs = query.state.data;
      if (runs?.every((run) => run.state === "complete")) return false;
      return runs?.some(isRunning) ? RUNNING_POLL_MS : IDLE_POLL_MS;
    },
  });
}

const LABELS: Record<string, string> = {
  reconcile: "Saving knowledge", "reconciliation-input": "Reading evidence", extraction: "Extracting knowledge",
  "duplicate-guard": "Comparing existing claims", embeddings: "Indexing knowledge", describe: "Describing subjects", tidy: "Tidying entities", profiles: "Writing stakeholder cards",
  expand: "Expanding definitions", plan: "Planning pages", pages: "Updating and reviewing pages", curate: "Tidying the page tree",
  hierarchy: "Organizing topics", place: "Filing into topics", duplicates: "Merging repeated claims", "settle-pages": "Checking final page updates", glossary: "Writing dictionary entries",
};

// What the live counts are counting, per role that reports them
const PROGRESS_UNITS: Record<string, string> = { extraction: "batches", pages: "sections" };

// THE STAGES IN ORDER: the knowledge commit is two steps inside "reconcile", then its cleanup; then the articles
const STAGES = [
  { title: "Knowledge", keys: ["reconciliation-input", "extraction", "reconcile", ...KNOWLEDGE_STAGES] },
  { title: "Articles", keys: [...ARTICLE_STAGES] },
];
const RECONCILE_PARTS = ["reconciliation-input", "extraction"];

type StageState = "done" | "running" | "failed" | "stopped" | "todo";

function stageState(workflow: UploadWorkflow, key: string): StageState {
  const byKey = new Map(workflow.steps.map((step) => [step.key, step]));
  // A commit adopted from an older run has no extraction steps of its own
  if (RECONCILE_PARTS.includes(key) && byKey.get("reconcile")?.state === "succeeded") return "done";
  const step = byKey.get(key);
  const part = RECONCILE_PARTS.indexOf(key);
  // The next part of a running commit is current as soon as the one before it is done
  if (!step && part > 0 && byKey.get("reconcile")?.state === "running" && byKey.get(RECONCILE_PARTS[part - 1]!)?.state === "succeeded") {
    return isRunning(workflow) ? "running" : "stopped";
  }
  if (!step) return "todo";
  if (step.state === "succeeded") return "done";
  if (step.state === "failed") return step.error === "Cancelled" ? "stopped" : "failed";
  // "reconcile" wraps its three parts: it is only the current stage once they are done
  // (a commit adopted from an older run has none of its parts, and is current straight away)
  if (key === "reconcile" && RECONCILE_PARTS.some((part) => byKey.has(part)) && RECONCILE_PARTS.some((part) => byKey.get(part)?.state !== "succeeded")) return "todo";
  // A step left running by a run that is no longer alive stopped there
  return isRunning(workflow) ? "running" : "stopped";
}

// The stage working now with its live count, e.g. "Extracting knowledge · 3 of 12 batches"
function currentActivity(workflow: UploadWorkflow): string | null {
  if (!isRunning(workflow)) return null;
  const key = STAGES.flatMap((group) => group.keys).find((stage) => stageState(workflow, stage) === "running");
  if (!key) return null;
  return `${LABELS[key]}${progressText(workflow, key)}`;
}

function progressText(workflow: UploadWorkflow, key: string): string {
  const progress = workflow.progress;
  if (!progress || progress.step !== key || !progress.total) return "";
  return ` · ${Math.min(progress.done + 1, progress.total)} of ${progress.total} ${PROGRESS_UNITS[key] ?? ""}`.trimEnd();
}

const ICONS: Record<StageState, React.ReactNode> = {
  done: <Check className="size-3.5 text-applied" aria-hidden />,
  running: <LoaderCircle className="size-3.5 animate-spin" aria-hidden />,
  failed: <X className="size-3.5 text-destructive" aria-hidden />,
  stopped: <Minus className="size-3.5 text-muted-foreground" aria-hidden />,
  todo: <Circle className="size-2 text-muted-foreground/50" aria-hidden />,
};
const STATE_NAMES: Record<StageState, string> = { done: "done", running: "in progress", failed: "failed", stopped: "stopped", todo: "not started" };

// EVERY STAGE with its state, so a person sees where the upload is and what is left
function StageList({ workflow }: { workflow: UploadWorkflow }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {STAGES.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</p>
          <ol className="flex flex-col gap-0.5">
            {group.keys.map((key) => {
              const state = stageState(workflow, key);
              return (
                <li key={key} className={cn("flex items-center gap-2 text-xs", state === "todo" ? "text-muted-foreground" : "text-foreground")}>
                  <span className="flex size-3.5 items-center justify-center">{ICONS[state]}</span>
                  <span>{LABELS[key]}{state === "running" ? progressText(workflow, key) : ""}</span>
                  <span className="sr-only">({STATE_NAMES[state]})</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

// CANCEL: a route rather than a Server Action, so it is not queued behind the upload it stops
function CancelUploadButton({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/uploads/${eventId}/cancel`, { method: "POST" });
      const body = (await response.json()) as { ok: boolean; error?: string };
      if (!body.ok) setError(body.error ?? "The upload could not be cancelled.");
      await queryClient.invalidateQueries({ queryKey: ["table", "upload_workflows"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void cancel()}>
        {pending ? "Cancelling…" : "Cancel"}
      </Button>
      <div className="max-w-48 whitespace-normal break-words"><ErrorNote error={error} /></div>
    </div>
  );
}

// The status's tone: green when done cleanly, red on an error, amber when it needs a person or a resume
function workflowTone(workflow: UploadWorkflow): Tone {
  if (workflow.error) return "failed";
  if (workflow.state === "complete") return "applied";
  if (isRunning(workflow)) return "muted";
  return "needs-you";
}

// Share of the stages that are done, for the slim bar under a running status
function stageShare(workflow: UploadWorkflow): number {
  const keys = STAGES.flatMap((group) => group.keys);
  return keys.filter((key) => stageState(workflow, key) === "done").length / keys.length;
}

// COMPACT (tables): a dot and the status, the live stage and a progress bar under it; the buttons live in UploadWorkflowActions
function CompactStatus({ workflow }: { workflow: UploadWorkflow }) {
  const running = isRunning(workflow);
  const activity = currentActivity(workflow);
  const share = stageShare(workflow);
  const failed = workflow.steps.find((step) => step.state === "failed" && step.error && step.error !== "Cancelled" && step.error !== workflow.error);
  return (
    <div className="flex flex-col gap-1.5 whitespace-normal" aria-live="polite">
      <StatusDot tone={workflowTone(workflow)} label={workflowLabel(workflow)} busy={running} className="font-medium" />
      {activity ? <p className="text-xs text-muted-foreground">{activity}</p> : null}
      {running ? (
        <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Stages done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
          <div className="h-full w-(--share) rounded-full bg-foreground/60 transition-all duration-500" style={{ "--share": `${Math.max(share * 100, 4)}%` } as React.CSSProperties} />
        </div>
      ) : null}
      {workflow.error ? <ErrorNote error={workflow.error} /> : failed ? <ErrorNote error={`${LABELS[failed.key] ?? "Document processing"}: ${failed.error}`} /> : null}
      {workflow.waiting ? <TextLink href="/exceptions" className="text-xs">Review pending decisions</TextLink> : null}
    </div>
  );
}

// TABLE ACTIONS: Cancel while it runs, Resume when it stopped (Retry for an old upload that failed)
export function UploadWorkflowActions({ eventId, allowRetry = true, legacyStatus }: { eventId: string; allowRetry?: boolean; legacyStatus?: string }) {
  const query = useUploadWorkflows([eventId]);
  const workflow = query.data?.[0];
  if (query.isPending || query.error) return null;
  if (!workflow) return allowRetry && legacyStatus === "failed" ? <RetryUploadButton eventId={eventId} /> : null;
  return (
    <>
      {canCancelUpload(workflow) ? <CancelUploadButton eventId={eventId} /> : null}
      {allowRetry && canResumeUpload(workflow) ? <RetryUploadButton eventId={eventId} /> : null}
    </>
  );
}

// An upload from before workflows were tracked: its event status and its error
function LegacyStatus({ status, error }: { status: string; error?: string | null }) {
  const tone = EVENT_TONE[status as keyof typeof EVENT_TONE] ?? "muted";
  return (
    <div className="flex flex-col gap-1.5 whitespace-normal">
      <StatusDot tone={tone} label={status === "reconciling" ? "Processing" : status} busy={["received", "extracting", "reconciling", "checking"].includes(status)} className="font-medium" />
      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}

// `compact` (tables): the status line and its live activity, without the stage list
export function UploadWorkflowStatus({ eventId, allowRetry = true, legacyStatus, legacyError, compact = false }: { eventId: string; allowRetry?: boolean; legacyStatus?: string; legacyError?: string | null; compact?: boolean }) {
  const query = useUploadWorkflows([eventId]);
  const workflow = query.data?.[0];
  if (query.error) return <ErrorNote error="Processing progress could not be loaded. Refresh to try again." />;
  if (!workflow && compact) return legacyStatus ? <LegacyStatus status={legacyStatus} error={legacyError} /> : null;
  if (!workflow) return legacyStatus ? <div className="flex flex-col gap-2"><span>{legacyStatus}</span>{!query.isPending && allowRetry && legacyStatus === "failed" ? <RetryUploadButton eventId={eventId} /> : null}</div> : null;
  if (compact) return <CompactStatus workflow={workflow} />;
  // One failure is listed once: the roles that wrap it (extraction inside the knowledge commit)
  // repeat its message, and a cancel marks the roles it interrupted
  const failed = workflow.steps.filter((step) => step.state === "failed" && !step.key.startsWith("extract:") && step.error !== "Cancelled")
    .filter((step, index, all) => step.error !== workflow.error && all.findIndex((other) => other.error === step.error) === index);
  const activity = currentActivity(workflow);
  const showStages = !compact && workflow.state !== "complete" && !workflow.waiting;
  return (
    <div className="flex flex-col gap-2 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p>{workflowLabel(workflow)}{workflow.cancel_requested && isRunning(workflow) ? "…" : activity ? ` · ${activity}…` : ""}</p>
        <div className="flex items-start gap-2">
          {canCancelUpload(workflow) ? <CancelUploadButton eventId={eventId} /> : null}
          {allowRetry && canResumeUpload(workflow) ? <RetryUploadButton eventId={eventId} /> : null}
        </div>
      </div>
      {showStages ? <StageList workflow={workflow} /> : null}
      {workflow.error ? <ErrorNote error={workflow.error} /> : null}
      {failed.length ? <ul className="space-y-1">{failed.map((step) => <li key={step.key}><ErrorNote error={`${LABELS[step.key] ?? "Document processing"}: ${step.error}`} /></li>)}</ul> : null}
      {workflow.waiting ? <TextLink href="/exceptions">Review pending decisions</TextLink> : null}
    </div>
  );
}
