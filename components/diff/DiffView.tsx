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

// INLINE DIFF: one running text, removed words struck and added words underlined in place
export function InlineDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <span className={className}>
      {parts.map((part, index) => (
        <span key={index} className={cn(PART_CLASS[part.kind], touchesReplacement(parts, index) && "mr-1")}>
          {part.text}
        </span>
      ))}
    </span>
  );
}

// SPLIT DIFF: before and after side by side, removed words struck on the left
// and added words underlined on the right
export function SplitDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <div className={cn("grid grid-cols-2 gap-x-4", className)}>
      <DiffSide parts={parts} hide="added" empty={before === ""} />
      <DiffSide parts={parts} hide="removed" empty={after === ""} />
    </div>
  );
}

// One column of a split diff; a side with no text shows a dash
function DiffSide({ parts, hide, empty }: { parts: DiffPart[]; hide: DiffPart["kind"]; empty: boolean }) {
  if (empty) return <span className="opacity-60">—</span>;
  return (
    <span>
      {parts
        .filter((part) => part.kind !== hide)
        .map((part, index) => (
          <span key={index} className={PART_CLASS[part.kind]}>
            {part.text}
          </span>
        ))}
    </span>
  );
}

// A struck word runs straight into the word that replaces it, so it needs a visual gap
function touchesReplacement(parts: DiffPart[], index: number): boolean {
  const part = parts[index] as DiffPart;
  return part.kind === "removed" && parts[index + 1]?.kind === "added" && !/\s$/.test(part.text);
}

type DiffLineProps ={ label: string; parts: DiffPart[]; hide: DiffPart["kind"] };

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
