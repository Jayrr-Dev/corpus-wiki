import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { type DiffPart, diffWords } from "./diffWords";

export type DiffViewProps = {
  // null when there was nothing before (a new unit) or nothing after
  before: string | null;
  after: string | null;
  className?: string;
};

// MARKS: removed words are struck in Dull Red, added words underlined in Dull Green (marks, never fills)
const PART_CLASS: Record<DiffPart["kind"], string> = {
  same: "",
  removed: "line-through decoration-failed decoration-2 text-muted-foreground",
  added: "underline decoration-applied decoration-2 underline-offset-2",
};

// DIFF VIEW: word-level before/after of two texts, one labelled line each
export function DiffView({ before, after, className }: DiffViewProps) {
  const parts = useMemo(() => diffWords(before ?? "", after ?? ""), [before, after]);
  return (
    <dl className={cn("grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-1 text-panel", className)}>
      {before !== null ? <DiffLine label="Before" parts={parts} hide="added" /> : null}
      {after !== null ? <DiffLine label="After" parts={parts} hide="removed" /> : null}
    </dl>
  );
}

type DiffLineProps = { label: string; parts: DiffPart[]; hide: DiffPart["kind"] };

// ONE SIDE: every part except the other side's changes
function DiffLine({ label, parts, hide }: DiffLineProps) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd>
        {parts
          .filter((part) => part.kind !== hide)
          .map((part, index) => (
            <span key={index} className={PART_CLASS[part.kind]}>
              {part.text}
            </span>
          ))}
      </dd>
    </>
  );
}
