"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ProcessUploadResult } from "@/lib/ingest";
import { processUpload, startUpload } from "@/lib/server-actions/upload";

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
  | { kind: "error"; error: string; eventId: string | null };

// Server action call that never throws (a network failure becomes an error result)
async function safely<T>(run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await run();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ONE FILE'S UPLOAD: phase plus the start function
export function useUploadFlow(): { phase: UploadPhase; start: (file: File, sourceDate: string) => Promise<void> } {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });

  const start = async (file: File, sourceDate: string) => {
    setPhase({ kind: "starting" });
    const formData = new FormData();
    formData.set("file", file);
    formData.set("sourceDate", sourceDate);
    const started = await safely(() => startUpload(formData));
    if (!started.ok) return setPhase({ kind: "error", error: started.error, eventId: null });
    if (started.kind === "skipped") return setPhase({ kind: "skipped", sourceId: started.sourceId });
    const { eventId, sourceId } = started;
    setPhase({ kind: "processing", eventId, sourceId });
    const processed = await safely(() => processUpload(eventId));
    await queryClient.invalidateQueries({ queryKey: ["table"] });
    if (!processed.ok) return setPhase({ kind: "error", error: processed.error, eventId });
    setPhase({ kind: "done", eventId, sourceId, result: processed });
  };

  return { phase, start };
}
