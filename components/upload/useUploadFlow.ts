"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { startProgress } from "@/components/toast";
import type { ProcessUploadResult, StartUploadResult } from "@/lib/ingest";
import { DIRECT_UPLOAD_FORMATS, formatOf } from "@/lib/ingest/formats";
import type { ActionResult } from "@/lib/server-actions/result";
import { prepareDirectUpload, processUpload, retryUpload, startUpload, startUploadFromPath } from "@/lib/server-actions/upload";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { startLinkUpload } from "@/lib/server-actions/upload";

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
  if (phase.kind === "done" && !phase.result.workflow && phase.result.status === "failed") return { eventId: phase.eventId, sourceId: phase.sourceId };
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

// STEP 1 FOR ONE FILE: most files go in the action's form body; a video is too big for it
// (20 MB, next.config.ts), so the browser puts it in Storage at a signed URL and the
// server reads it from there
async function startFileUpload(file: File, sourceDate: string): Promise<ActionResult<StartUploadResult>> {
  const format = formatOf(file.name, file.type);
  if (format && DIRECT_UPLOAD_FORMATS.includes(format.id)) {
    const prepared = await prepareDirectUpload({ fileName: file.name, browserType: file.type, byteSize: file.size });
    if (!prepared.ok) return prepared;
    const { error } = await getBrowserSupabase().storage.from("sources").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type || undefined });
    if (error) return { ok: false, error: `The file could not be uploaded: ${error.message}` };
    return startUploadFromPath({ path: prepared.path, fileName: file.name, browserType: file.type, sourceDate });
  }
  const formData = new FormData();
  formData.set("file", file);
  formData.set("sourceDate", sourceDate);
  return startUpload(formData);
}

export type UploadFlow = {
  phase: UploadPhase;
  start: (file: File, sourceDate: string) => Promise<void>;
  startLink: (url: string, sourceDate: string) => Promise<void>;
  // runs step 2 again for a failed upload, with the model chosen now
  retry: () => Promise<void>;
};

// ONE FILE'S UPLOAD: phase plus the start and retry functions
export function useUploadFlow(): UploadFlow {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });

  // STEP 2 (first run or retry): polls while it runs, then shows the end status
  const runPipeline = async (eventId: string, sourceId: string, name: string, run: (id: string) => Promise<ActionResult<ProcessUploadResult>>) => {
    setPhase({ kind: "processing", eventId, sourceId });
    const progress = startProgress(`Processing “${name}”`, "Reading the file with AI…");
    const processed = await safely(() => run(eventId));
    await queryClient.invalidateQueries({ queryKey: ["table"] });
    if (!processed.ok || processed.status === "failed" || processed.workflow?.state === "incomplete") progress.fail();
    else progress.done();
    if (!processed.ok) return setPhase({ kind: "error", error: processed.error, eventId, sourceId });
    setPhase({ kind: "done", eventId, sourceId, result: processed });
  };

  const [fileName, setFileName] = useState("");

  const start = async (file: File, sourceDate: string) => {
    setFileName(file.name);
    setPhase({ kind: "starting" });
    const started = await safely(() => startFileUpload(file, sourceDate));
    if (!started.ok) return setPhase({ kind: "error", error: started.error, eventId: null, sourceId: null });
    if (started.kind === "skipped") return setPhase({ kind: "skipped", sourceId: started.sourceId });
    await runPipeline(started.eventId, started.sourceId, file.name, processUpload);
  };

  const retry = async () => {
    const target = retryTarget(phase);
    if (target) await runPipeline(target.eventId, target.sourceId, fileName, retryUpload);
  };

  const startLink = async (url: string, sourceDate: string) => {
    setFileName(url);
    setPhase({ kind: "starting" });
    const started = await safely(() => startLinkUpload(url, sourceDate));
    if (!started.ok) return setPhase({ kind: "error", error: started.error, eventId: null, sourceId: null });
    if (started.kind === "skipped") return setPhase({ kind: "skipped", sourceId: started.sourceId });
    await runPipeline(started.eventId, started.sourceId, url, processUpload);
  };

  return { phase, start, startLink, retry };
}
