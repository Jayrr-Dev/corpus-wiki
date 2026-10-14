"use client";

import { useState } from "react";
import { ErrorNote, TextLink } from "@/app/(app)/_components/bits";
import { toDateInputValue } from "@/app/(app)/_lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatOf } from "@/lib/ingest/formats";
import { useLiveShiftEvent } from "@/lib/queries/screens";
import { EventProgress } from "./EventProgress";
import { type UploadPhase, useUploadFlow } from "./useUploadFlow";

// UPLOAD ITEM: one chosen file with its own date, an Upload button and the live result
export function UploadItem({ file }: { file: File }) {
  const [sourceDate, setSourceDate] = useState(() => toDateInputValue(file.lastModified));
  const { phase, start } = useUploadFlow();
  const isBusy = phase.kind === "starting" || phase.kind === "processing";
  const inputId = `date-${file.name}-${file.lastModified}`;
  return (
    <li className="flex flex-col gap-2 border-b py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
        <span className="text-xs text-faint">{formatOf(file.name, file.type)?.label}</span>
        <label htmlFor={inputId} className="text-xs text-faint">
          File date
        </label>
        <Input id={inputId} type="date" value={sourceDate} onChange={(event) => setSourceDate(event.target.value)} disabled={phase.kind !== "idle"} className="w-40" />
        <Button size="sm" disabled={!sourceDate || phase.kind !== "idle"} onClick={() => start(file, sourceDate)}>
          {isBusy ? "Uploading…" : "Upload"}
        </Button>
      </div>
      <UploadStatus phase={phase} />
    </li>
  );
}

// STATUS LINE PER PHASE (the event is polled while the pipeline runs)
function UploadStatus({ phase }: { phase: UploadPhase }) {
  const eventId = phase.kind === "processing" || phase.kind === "done" ? phase.eventId : undefined;
  const { data: event } = useLiveShiftEvent(eventId, phase.kind === "processing");
  if (phase.kind === "idle") return null;
  if (phase.kind === "starting") return <p className="text-xs text-faint">Storing the file and reading its text…</p>;
  if (phase.kind === "error") return <ErrorNote error={phase.error} />;
  if (phase.kind === "skipped") {
    return (
      <p className="text-panel text-muted-foreground">
        Already uploaded. <TextLink href={`/sources/${phase.sourceId}`}>Open the source</TextLink>
      </p>
    );
  }
  if (phase.kind === "processing") return <EventProgress status={event?.status ?? "received"} />;
  return <UploadResult phase={phase} />;
}

// FINAL RESULT: the end status, links to the change set and source, and the error text when it failed
function UploadResult({ phase }: { phase: Extract<UploadPhase, { kind: "done" }> }) {
  const { result, sourceId } = phase;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <EventProgress status={result.status} />
        {result.changeSetId ? <TextLink href={`/changes/${result.changeSetId}`}>Open change set</TextLink> : null}
        <TextLink href={`/sources/${sourceId}`}>Open source</TextLink>
      </div>
      {result.status === "failed" ? <ErrorNote error={result.error ?? "The upload failed."} /> : null}
    </div>
  );
}
