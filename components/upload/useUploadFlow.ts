"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ProcessUploadResult } from "@/lib/ingest";
import type { ActionResult } from "@/lib/server-actions/result";
import { processUpload, retryUpload, startUpload } from "@/lib/server-actions/upload";

// =====================================================================
// UPLOAD FLOW: step 1 stores the file and opens the shift event; step 2
// runs the pipeline. While step 2 runs, the screen polls the event.
// =====================================================================

export type UploadPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "skipped"; sourceId: string }
  | { kind: "processing"; eventId: string; sourceId: string }
  | { kind: "done"; eventId: string; sourceId: string; result: ProcessUploadResult }
  | { kind: "error"; error: string; eventId: string | null; sourceId: string | null };

// The failed upload a Retry would run again (null when there is nothing stored to retry)
export function retryTarget(phase: UploadPhase): { eventId: string; sourceId: string } | null {
  if (phase.kind === "done" && phase.result.status === "failed") return { eventId: phase.eventId, sourceId: phase.sourceId };
  if (phase.kind === "error" && phase.eventId && phase.sourceId) return { eventId: phase.eventId, sourceId: phase.sourceId };
  return null;
}

// Server action call that never throws (a network failure becomes an error result)
async function safely<T>(run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await run();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type UploadFlow = {
  phase: UploadPhase;
  start: (file: File, sourceDate: string) => Promise<void>;
  // runs step 2 again for a failed upload, with the model chosen now
  retry: () => Promise<void>;
};

// ONE FILE'S UPLOAD: phase plus the start and retry functions
export function useUploadFlow(): UploadFlow {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });

  // STEP 2 (first run or retry): polls while it runs, then shows the end status
  const runPipeline = async (eventId: string, sourceId: string, run: (id: string) => Promise<ActionResult<ProcessUploadResult>>) => {
    setPhase({ kind: "processing", eventId, sourceId });
    const processed = await safely(() => run(eventId));
    await queryClient.invalidateQueries({ queryKey: ["table"] });
    if (!processed.ok) return setPhase({ kind: "error", error: processed.error, eventId, sourceId });
    setPhase({ kind: "done", eventId, sourceId, result: processed });
  };

  const start = async (file: File, sourceDate: string) => {
    setPhase({ kind: "starting" });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("sourceDate", sourceDate);
    const started = await safely(() => startUpload(formData));
    if (!started.ok) return setPhase({ kind: "error", error: started.error, eventId: null, sourceId: null });
    if (started.kind === "skipped") return setPhase({ kind: "skipped", sourceId: started.sourceId });
    await runPipeline(started.eventId, started.sourceId, processUpload);
  };

  const retry = async () => {
    const target = retryTarget(phase);
    if (target) await runPipeline(target.eventId, target.sourceId, retryUpload);
  };

  return { phase, start, retry };
}
