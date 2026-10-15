import { statusLabel } from "@/app/(app)/_lib/format";
import type { Tone } from "@/app/(app)/_lib/tone";
import { cn } from "@/lib/utils";

// DOT FILL PER TONE (the accent is only ever this 6px mark)
const DOT_CLASS: Record<Tone, string> = {
  applied: "bg-applied",
  "needs-you": "bg-needs-you",
  failed: "bg-failed",
  stale: "bg-stale",
  faint: "bg-faint",
  muted: "bg-muted-foreground",
};

type StatusDotProps = { tone: Tone; label?: string; className?: string; busy?: boolean };

// STATUS DOT: a small colored dot, with the status in words beside it when `label` is given
export function StatusDot({ tone, label, className, busy = false }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {busy ? (
        <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
      ) : (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[tone])} />
      )}
      {label ? <span className={tone === "faint" ? "text-faint" : undefined}>{statusLabel(label)}</span> : null}
    </span>
  );
}
