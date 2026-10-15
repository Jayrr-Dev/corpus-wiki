import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { statusLabel } from "@/app/(app)/_lib/format";
import { EVENT_TONE } from "@/app/(app)/_lib/tone";
import type { Enums } from "@/lib/database/types";
import { cn } from "@/lib/utils";

type EventStatus = Enums<"event_status">;

// PIPELINE STEPS IN ORDER (the last step is whichever end the event reached)
const STEPS: readonly EventStatus[] = ["received", "extracting", "reconciling", "checking"];

// EVENT PROGRESS: the steps an upload event moves through, the current one in full text
export function EventProgress({ status }: { status: EventStatus }) {
  const reached = STEPS.indexOf(status);
  const isFinished = reached === -1;
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {STEPS.map((step, index) => (
        <li key={step} className={cn(isFinished || index < reached ? "text-muted-foreground" : index === reached ? "text-text" : "text-faint")}>
          {statusLabel(step)}
          {index === reached ? "…" : null}
          <span className="ml-2 text-faint">→</span>
        </li>
      ))}
      <li>{isFinished ? <StatusDot tone={EVENT_TONE[status]} label={status} /> : <span className="text-faint">Done</span>}</li>
    </ol>
  );
}
