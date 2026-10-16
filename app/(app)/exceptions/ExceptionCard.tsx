"use client";

import { ReviewSummary } from "@/components/standard/ReviewSummary";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { readUnitReferences, splitUnitReferences, type UnitReference } from "@/lib/ai/unitReferences";


import { type ReactNode, useState } from "react";
import { targetHref } from "@/app/(app)/_components/ActionSummary";
import { Note, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { asObject, describeActionInput, EXCEPTION_REASON_TEXT, humanize, readString, readStrings } from "@/app/(app)/_lib/format";
import { EXCEPTION_TONE } from "@/app/(app)/_lib/tone";
import { usePersonName } from "@/app/(app)/_lib/useActorLabel";
import type { Tables } from "@/lib/database/types";
import type { UnitSummary } from "@/lib/queries/screens";
import { cn } from "@/lib/utils";
import { AnswerForm } from "./AnswerForm";
import { CATEGORY_OF_REASON, CATEGORY_TABS } from "./categories";
import { type DiffPart, wordDiff } from "./wordDiff";

type ExceptionCardProps = {
  exception: Tables<"exceptions">;
  action: Tables<"actions"> | undefined;
  // the unit the held action changes, when it targets one
  unit: UnitSummary | undefined;
  // on an applied action, the text it replaced (the unit itself already reads as the proposal)
  before?: string | null;
  onView?: () => void;
};

// EXCEPTION CARD: what was raised, the AI's reason, the change side by side with what stands now, the source, then the answer
export function ExceptionCard({ exception, action, unit, before = null, onView }: ExceptionCardProps) {
  // The answer given here, shown at once while the server saves it and the list refreshes
  const [decided, setDecided] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const decide = (accept: boolean) => {
    setFailure(null);
    setDecided(accept);
  };
  const fail = (error: string) => {
    setDecided(null);
    setFailure(error);
  };
  if (exception.status === "open" && decided !== null) return <DecidedRow title={exceptionTitle(exception, action)} accepted={decided} />;
  const evidence = asObject(exception.evidence);
  const quote = readString(evidence, "quote");
  // The AI's reason: `rationale` on proposals, `reason` on retires
  const input = action ? asObject(action.input) : null;
  const rationale = input ? (readString(input, "rationale") ?? readString(input, "reason")) : null;
  const detail = readString(evidence, "detail");
  const repeatedDetail = detail?.trim() === rationale?.trim();
  return (
    <article className="overflow-hidden rounded-lg border">
      {onView && <div className="flex justify-end px-3 pt-2"><Button variant="ghost" size="sm" onClick={onView}>View exception</Button></div>}
      <CardHeader exception={exception} action={action} detail={input?.domainReview === true || repeatedDetail ? null : detail} domainPaths={readStrings(evidence, "domainPaths")} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        {action?.type === "review_page" ? <div className="space-y-2 text-panel"><p className="text-muted-foreground">Accepting records your decision. Edit the page separately to apply it.</p><TextLink href={`/p/${encodeURIComponent(readString(input!, "pageSlug") ?? "")}`}>Open reviewed page</TextLink><details className="text-muted-foreground"><summary className="cursor-pointer">Review guideline</summary><p className="mt-2">{readString(input!, "guideline")}</p></details></div> : null}
        {rationale && input?.domainReview === true ? <ReviewSummary text={rationale} /> : rationale ? <Rationale text={rationale} references={readUnitReferences(input?.rationaleReferences)} currentClaim={before ?? unit?.content} /> : null}
        {action ? <Comparison action={action} unit={unit} before={before} lineText={readString(evidence, "lineText")} /> : <Note>The held action could not be loaded.</Note>}
        {quote ? <SourceExcerpt quote={quote} /> : null}
      </div>
      <footer className="border-t bg-sidebar px-4 py-3">
        {exception.status === "open" ? <AnswerForm exceptionId={exception.id} onDecided={decide} onFailed={fail} error={failure} recommendationOnly={action?.type === "review_page"} /> : <Answered exception={exception} />}
      </footer>
    </article>
  );
}

// HEADER: category and raised time above the reason (the decision lives in the Answered footer), then the detail when it says more than the reason
function CardHeader({ exception, action, detail, domainPaths }: { exception: Tables<"exceptions">; action: Tables<"actions"> | undefined; detail: string | null; domainPaths: string[] }) {
  const title = exceptionTitle(exception, action);
  const category = CATEGORY_TABS.find((tab) => tab.id === CATEGORY_OF_REASON[exception.reason]);
  return (
    <header className="flex flex-col gap-1 px-4 pt-4 pb-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium tracking-wide text-faint uppercase">{category?.label}</span>
        <span className="flex items-center gap-1.5 text-faint">
          Raised
          <time className="font-mono" dateTime={exception.created_at}>
            <DateTime iso={exception.created_at} />
          </time>
        </span>
      </div>
      <h3 className="text-body font-medium">{title}</h3>
      {detail && !restates(title, detail) ? <p className="text-panel text-muted-foreground">{detail}</p> : null}
      {domainPaths.length > 0 ? <DomainTree paths={domainPaths} /> : null}
    </header>
  );
}

type DomainNode = { name: string; children: DomainNode[] };

// The flat paths ("Topics/Health & Safety/PPE") folded into a tree, children sorted by name
function domainTree(paths: string[]): DomainNode[] {
  const roots: DomainNode[] = [];
  for (const path of paths) {
    let level = roots;
    for (const name of path.split("/").filter(Boolean)) {
      let node = level.find((child) => child.name === name);
      if (!node) level.push((node = { name, children: [] }));
      level = node.children;
    }
  }
  const sort = (nodes: DomainNode[]): DomainNode[] => nodes.sort((a, b) => a.name.localeCompare(b.name)).map((node) => ({ ...node, children: sort(node.children) }));
  return sort(roots);
}

// DOMAIN TREE: the drafted domains as an indented outline, one per line, nested under their parents
function DomainTree({ paths }: { paths: string[] }) {
  return (
    <section className="mt-2 flex flex-col gap-1.5 rounded-md border p-3">
      <h4 className="text-xs font-medium tracking-wide text-faint uppercase">Domains · {paths.length}</h4>
      <DomainList nodes={domainTree(paths)} />
    </section>
  );
}

function DomainList({ nodes, nested = false }: { nodes: DomainNode[]; nested?: boolean }) {
  return (
    <ul className={cn("flex flex-col gap-0.5 text-panel", nested && "ml-1.5 border-l pl-3")}>
      {nodes.map((node) => (
        <li key={node.name}>
          <span className={cn(node.children.length > 0 && "font-medium")}>{node.name}</span>
          {node.children.length > 0 ? <DomainList nodes={node.children} nested /> : null}
        </li>
      ))}
    </ul>
  );
}

// What the AI wants to retire, named by the held action, so a removal card says more than "knowledge"
const RETIRES: Partial<Record<Tables<"actions">["type"], string>> = {
  retire_claim: "The AI wants to retire a claim",
  retire_entity: "The AI wants to retire an entity",
  merge_entity: "The AI wants to merge two entities",
  retire_domain: "The AI wants to retire a domain",
  merge_duplicates: "The AI wants to merge and retire duplicate claims",
};

export function exceptionTitle(exception: Tables<"exceptions">, action: Tables<"actions"> | undefined): string {
  if (action?.type === "review_page") return "Page review recommendation";
  return (exception.reason === "deletion" && action && RETIRES[action.type]) || EXCEPTION_REASON_TEXT[exception.reason];
}

// Whether the detail line only repeats the reason (most of its words already in the title)
function restates(title: string, detail: string): boolean {
  const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];
  const titleWords = new Set(words(title));
  const detailWords = words(detail);
  return detailWords.length > 0 && detailWords.filter((word) => titleWords.has(word)).length / detailWords.length >= 0.7;
}

// RATIONALE: the AI's own reason for the change, a block under the header read before the comparison
function Rationale({ text, references, currentClaim }: { text: string; references: UnitReference[]; currentClaim?: string }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-md border p-3">
      <h4 className="text-xs font-medium tracking-wide text-faint uppercase">Why this matters</h4>
      <p className="text-panel leading-relaxed">{splitUnitReferences(text).map((part, index) => {
        if (!part.label) return part.text;
        const reference = references.find((item) => item.label === part.label);
        const content = <span className="block space-y-2 text-left">
          <span className="block font-semibold">{part.label} · {reference ? "Claim at proposal time" : "Original reference unavailable"}</span>
          {reference ? <>
            <span className="block leading-relaxed">{reference.content}</span>
            <span className="block text-xs opacity-75">{humanize(reference.kind)} · {humanize(reference.epistemicStatus)}. Click the reference to open this unit.</span>
          </> : <>
            <span className="block leading-relaxed">This older proposal did not save which claim {part.label} referred to.</span>
            {currentClaim && <span className="block border-t border-current/20 pt-2 leading-relaxed"><span className="mb-1 block font-medium">Claim being reviewed (not a confirmed {part.label} mapping)</span>{currentClaim}</span>}
          </>}
        </span>;
        const className = "rounded-sm text-link underline decoration-dotted underline-offset-3 hover:decoration-solid";
        return <Tooltip key={index} content={content} className="max-h-[min(28rem,70vh)] max-w-[min(24rem,calc(100vw-2rem))] overflow-y-auto whitespace-normal" align="start">
          {reference ? <TextLink href={`/units/${reference.unitId}`} className={className} aria-label={`${part.text}: preview claim or open unit`}>{part.text}</TextLink> : <button type="button" className={`${className} cursor-help`} aria-label={`Context for ${part.text}`}>{part.text}</button>}
        </Tooltip>;
      })}</p>
    </section>
  );
}

// COMPARISON: the unit (or, for a line change, the line's text when asked) as it stands beside
// the proposed change, with changed words marked
type ComparisonProps = { action: Tables<"actions">; unit: UnitSummary | undefined; before: string | null; lineText: string | null };
function Comparison({ action, unit, before, lineText }: ComparisonProps) {
  const proposed = describeActionInput(action.type, action.input);
  const href = targetHref(action.type, action.target_id);
  const current = before ?? unit?.content ?? lineText ?? undefined;
  const isRevision = unit ? action.type === "revise_claim" || action.type === "add_claim" : action.type === "revise_line";
  const diff = (unit || lineText !== null) && current !== undefined && isRevision ? wordDiff(current, proposed) : null;
  const proposedPane = (
    <Pane label={action.type === "review_page" ? "Suggested action" : `Proposed · ${humanize(action.type)}`} emphasis>
      {diff ? <DiffText parts={diff} show="added" /> : proposed || <span className="text-faint">No details</span>}
    </Pane>
  );
  if (!unit && lineText === null) return proposedPane;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Pane label={before === null ? "Current" : "Before"} link={href ? <TextLink href={href}>Open unit</TextLink> : null}>
        {diff ? <DiffText parts={diff} show="removed" /> : current}
      </Pane>
      {proposedPane}
    </div>
  );
}

// PANE: a labelled box of text; the proposed side sits on the raised gray
function Pane({ label, link, emphasis = false, children }: { label: string; link?: ReactNode; emphasis?: boolean; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-2 rounded-md border p-3", emphasis && "bg-sidebar")}>
      <header className="flex items-center justify-between gap-2 text-xs">
        <h4 className="font-medium tracking-wide text-faint uppercase">{label}</h4>
        {link}
      </header>
      <p className="text-panel leading-relaxed">{children}</p>
    </section>
  );
}

// DIFF TEXT: shared words plain; one side's own words marked (added underlined green, removed struck red)
function DiffText({ parts, show }: { parts: DiffPart[]; show: "added" | "removed" }) {
  return parts
    .filter((part) => part.kind === "same" || part.kind === show)
    .map((part, index) => (
      <span key={index}>
        {index > 0 ? " " : null}
        {part.kind === "same" ? (
          part.text
        ) : show === "added" ? (
          <ins className="underline decoration-applied decoration-2 underline-offset-3">{part.text}</ins>
        ) : (
          <del className="text-muted-foreground decoration-failed decoration-2">{part.text}</del>
        )}
      </span>
    ));
}

// SOURCE EXCERPT: the quote the check read, clamped to three lines until opened
function SourceExcerpt({ quote }: { quote: string }) {
  const [open, setOpen] = useState(false);
  const long = quote.length > 220;
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium tracking-wide text-faint uppercase">Source excerpt</h4>
      <blockquote className={cn("border-l-2 pl-3 text-panel whitespace-pre-wrap text-muted-foreground", long && !open && "line-clamp-3")}>{quote}</blockquote>
      {long ? (
        <button type="button" className="self-start pl-3.5 text-xs text-link underline-offset-2 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show full excerpt"}
        </button>
      ) : null}
    </section>
  );
}

// DECIDED ROW: a just-answered card folded to one line until the refreshed list drops or moves it
function DecidedRow({ title, accepted }: { title: string; accepted: boolean }) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-panel">
      <span className="font-medium">{title}</span>
      <span className="flex items-center gap-3 text-muted-foreground">
        <StatusDot tone={accepted ? "applied" : "faint"} label={accepted ? "accepted" : "rejected"} />
        {accepted ? <span className="text-faint">Pages update in the background</span> : null}
      </span>
    </article>
  );
}

// ANSWERED: the decision, who answered and when, and the note on one line
function Answered({ exception }: { exception: Tables<"exceptions"> }) {
  const answeredBy = usePersonName(exception.resolved_by_id);
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-panel">
      <StatusDot tone={EXCEPTION_TONE[exception.status]} label={exception.status} />
      {answeredBy ? <span className="text-faint">by {answeredBy}</span> : null}
      <span className="font-mono text-xs text-faint"><DateTime iso={exception.resolved_at} /></span>
      {exception.note ? <span className="text-muted-foreground">{exception.note}</span> : null}
    </p>
  );
}
