"use client";

import { type ReactNode, useState } from "react";
import { targetHref } from "@/app/(app)/_components/ActionSummary";
import { Note, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { asObject, describeActionInput, EXCEPTION_REASON_TEXT, formatDateTime, humanize, readString, readStrings } from "@/app/(app)/_lib/format";
import { EXCEPTION_TONE } from "@/app/(app)/_lib/tone";
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
};

// EXCEPTION CARD: what was raised, the change side by side with what stands now, the source, then the answer
export function ExceptionCard({ exception, action, unit }: ExceptionCardProps) {
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
  if (exception.status === "open" && decided !== null) return <DecidedRow exception={exception} accepted={decided} />;
  const evidence = asObject(exception.evidence);
  const quote = readString(evidence, "quote");
  return (
    <article className="overflow-hidden rounded-lg border">
      <CardHeader exception={exception} detail={readString(evidence, "detail")} domainPaths={readStrings(evidence, "domainPaths")} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        {action ? <Comparison action={action} unit={unit} /> : <Note>The held action could not be loaded.</Note>}
        {quote ? <SourceExcerpt quote={quote} /> : null}
      </div>
      <footer className="border-t bg-sidebar px-4 py-3">
        {exception.status === "open" ? <AnswerForm exceptionId={exception.id} onDecided={decide} onFailed={fail} error={failure} /> : <Answered exception={exception} />}
      </footer>
    </article>
  );
}

// HEADER: category and time above the reason, then the detail when it says more than the reason
function CardHeader({ exception, detail, domainPaths }: { exception: Tables<"exceptions">; detail: string | null; domainPaths: string[] }) {
  const title = EXCEPTION_REASON_TEXT[exception.reason];
  const category = CATEGORY_TABS.find((tab) => tab.id === CATEGORY_OF_REASON[exception.reason]);
  return (
    <header className="flex flex-col gap-1 px-4 pt-4 pb-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium tracking-wide text-faint uppercase">{category?.label}</span>
        <span className="flex items-center gap-3">
          {exception.status === "open" ? null : <StatusDot tone={EXCEPTION_TONE[exception.status]} label={exception.status} />}
          <time className="font-mono text-faint" dateTime={exception.created_at}>
            {formatDateTime(exception.created_at)}
          </time>
        </span>
      </div>
      <h3 className="text-body font-medium">{title}</h3>
      {detail && !restates(title, detail) ? <p className="text-panel text-muted-foreground">{detail}</p> : null}
      {domainPaths.length > 0 ? <p className="font-mono text-xs text-muted-foreground">{domainPaths.join(" · ")}</p> : null}
    </header>
  );
}

// Whether the detail line only repeats the reason (most of its words already in the title)
function restates(title: string, detail: string): boolean {
  const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];
  const titleWords = new Set(words(title));
  const detailWords = words(detail);
  return detailWords.length > 0 && detailWords.filter((word) => titleWords.has(word)).length / detailWords.length >= 0.7;
}

// COMPARISON: the unit as it stands beside the proposed change, with changed words marked
function Comparison({ action, unit }: { action: Tables<"actions">; unit: UnitSummary | undefined }) {
  const proposed = describeActionInput(action.type, action.input);
  const href = targetHref(action.type, action.target_id);
  const diff = unit && (action.type === "revise_claim" || action.type === "add_claim") ? wordDiff(unit.content, proposed) : null;
  const proposedPane = (
    <Pane label={`Proposed · ${humanize(action.type)}`} emphasis>
      {diff ? <DiffText parts={diff} show="added" /> : proposed || <span className="text-faint">No details</span>}
    </Pane>
  );
  if (!unit) return proposedPane;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Pane label="Current" link={href ? <TextLink href={href}>Open unit</TextLink> : null}>
        {diff ? <DiffText parts={diff} show="removed" /> : unit.content}
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
function DecidedRow({ exception, accepted }: { exception: Tables<"exceptions">; accepted: boolean }) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-panel">
      <span className="font-medium">{EXCEPTION_REASON_TEXT[exception.reason]}</span>
      <span className="flex items-center gap-3 text-muted-foreground">
        <StatusDot tone={accepted ? "applied" : "faint"} label={accepted ? "accepted" : "rejected"} />
        {accepted ? <span className="text-faint">Pages update in the background</span> : null}
      </span>
    </article>
  );
}

// ANSWERED: the decision, when, and the note on one line
function Answered({ exception }: { exception: Tables<"exceptions"> }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-panel">
      <StatusDot tone={EXCEPTION_TONE[exception.status]} label={exception.status} />
      <span className="font-mono text-xs text-faint">{formatDateTime(exception.resolved_at)}</span>
      {exception.note ? <span className="text-muted-foreground">{exception.note}</span> : null}
    </p>
  );
}
