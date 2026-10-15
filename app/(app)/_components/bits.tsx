import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { EVIDENCE_TONE } from "@/app/(app)/_lib/tone";
import { StatusGlyph } from "@/components/icons";
import { ErrorToast } from "@/components/toast";
import type { Evidence } from "@/lib/knowledge/evidence";
import type { UnitSummary } from "@/lib/queries/screens";
import { cn } from "@/lib/utils";

// =====================================================================
// SMALL SHARED PIECES: section blocks, links, notes and query states.
// =====================================================================

// SECTION: a small-caps heading over a block of a detail page
export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2 border-b pb-1">
        <h2 className="text-xs font-medium tracking-wide text-faint uppercase">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

// TEXT LINK: in-app link in the link accent
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cn("text-link underline-offset-2 hover:underline", className)} {...props} />;
}

// UNIT LINK: a unit's status glyph and content, linking to its page; retired units are faint
export function UnitLink({ unit, className }: { unit: UnitSummary; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-start gap-1.5", unit.retired_at && "text-faint", className)}>
      <StatusGlyph status={unit.epistemic_status} className="mt-0.5 shrink-0" />
      <TextLink href={`/units/${unit.id}`}>{unit.label || unit.content || unit.id}</TextLink>
      <EvidenceBadge evidence={unit.evidence} className="ml-1 shrink-0 text-xs" />
    </span>
  );
}

// EVIDENCE BADGE: shown only when the sources behind a unit are archived (stale) or deleted (lost)
export function EvidenceBadge({ evidence, className }: { evidence: Evidence | undefined; className?: string }) {
  if (evidence !== "stale" && evidence !== "lost") return null;
  const hint = evidence === "stale" ? "A file it cites is archived or replaced" : "A file it cites was deleted";
  return (
    <span title={hint} className={cn("text-muted-foreground", className)}>
      <StatusDot tone={EVIDENCE_TONE[evidence]} label={evidence} />
    </span>
  );
}

// QUOTE: evidence text set off by a gray 2px bar
export function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="border-l-2 pl-3 text-panel whitespace-pre-wrap">{children}</blockquote>;
}

// QUIET NOTE: one line of faint text (loading, nothing, not found)
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-panel text-faint">{children}</p>;
}

// ERROR NOTE: what went wrong, with a Dull Red dot as the only color; also pops it as a toast
export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-panel">
      <StatusDot tone="failed" className="mt-1.5" />
      <span>{error}</span>
      <ErrorToast message={error} />
    </p>
  );
}

// QUERY STATE: loading and error lines for a read; renders children once data is there
export function QueryState({ query, children }: { query: { isPending: boolean; error: Error | null }; children: ReactNode }) {
  if (query.error) return <ErrorNote error={`Could not load: ${query.error.message}`} />;
  if (query.isPending) return <Note>Loading…</Note>;
  return <>{children}</>;
}

// FACTS: a two-column label/value list for detail headers
export function Facts({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-panel">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-faint">{label}</dt>
          <dd className="min-w-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
