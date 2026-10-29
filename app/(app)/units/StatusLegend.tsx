"use client";

import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { EVIDENCE_TONE } from "@/app/(app)/_lib/tone";
import { HelpIcon, StatusMark } from "@/components/icons";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Constants, type Enums } from "@/lib/database/types";

// WHAT EACH EPISTEMIC STATUS MEANS, most to least certain
const MEANINGS: Record<Enums<"epistemic_status">, string> = {
  established: "Decided, or stated by an authoritative source such as a policy or procedure.",
  supported: "Stated with evidence behind it, but not formally decided.",
  assumed: "Taken as true without direct evidence in the source.",
  hypothesis: "Proposed, planned or asked about. Never a decision.",
  disputed: "Sources disagree, or the claim has been challenged.",
  unknown: "The source doesn't make its certainty clear.",
};

// WHAT EACH EVIDENCE BADGE MEANS (only these two are ever shown beside a unit)
const EVIDENCE_MEANINGS: Record<"stale" | "lost", string> = {
  stale: "A file it cites was archived or replaced by a newer version.",
  lost: "A file it cites was deleted without being purged. The knowledge is kept, but its source is gone.",
};

// STATUS LEGEND: a help icon in the status column's header that explains each glyph and evidence badge
export function StatusLegend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="What the status icons and evidence badges mean"
          className="flex items-center text-muted-foreground hover:text-text"
        >
          <HelpIcon size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-(--radix-popover-content-available-height) w-80 overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle>Status</PopoverTitle>
          <p className="text-muted-foreground">How certain each piece of knowledge is.</p>
        </PopoverHeader>
        <ul className="flex flex-col gap-2">
          {Constants.public.Enums.epistemic_status.map((status) => (
            <li key={status} className="flex gap-2">
              <StatusMark status={status} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium capitalize">{status}</div>
                <p className="text-muted-foreground">{MEANINGS[status]}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t pt-3">
          <PopoverHeader>
            <PopoverTitle>Evidence</PopoverTitle>
            <p className="text-muted-foreground">What happened to the files it cites. Shown only when something did.</p>
          </PopoverHeader>
        </div>
        <ul className="flex flex-col gap-2">
          {(["stale", "lost"] as const).map((evidence) => (
            <li key={evidence}>
              <StatusDot tone={EVIDENCE_TONE[evidence]} label={evidence} className="font-medium capitalize" />
              <p className="text-muted-foreground">{EVIDENCE_MEANINGS[evidence]}</p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
