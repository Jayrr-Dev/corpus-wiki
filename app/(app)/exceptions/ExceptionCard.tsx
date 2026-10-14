"use client";

import { ActionSummary } from "@/app/(app)/_components/ActionSummary";
import { Facts, Note, Quote } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { asObject, EXCEPTION_REASON_TEXT, formatDateTime, readString, readStrings } from "@/app/(app)/_lib/format";
import { EXCEPTION_TONE } from "@/app/(app)/_lib/tone";
import type { Tables } from "@/lib/database/types";
import type { UnitSummary } from "@/lib/queries/screens";
import { AnswerForm } from "./AnswerForm";

type ExceptionCardProps = {
  exception: Tables<"exceptions">;
  action: Tables<"actions"> | undefined;
  // the unit the held action changes, when it targets one
  unit: UnitSummary | undefined;
};

// EXCEPTION CARD: why it was raised, the evidence, the held action beside the current unit, and the answer
export function ExceptionCard({ exception, action, unit }: ExceptionCardProps) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{EXCEPTION_REASON_TEXT[exception.reason]}</h3>
        <span className="flex items-center gap-3 text-panel">
          <StatusDot tone={EXCEPTION_TONE[exception.status]} label={exception.status} />
          <span className="font-mono text-xs text-faint">{formatDateTime(exception.created_at)}</span>
        </span>
      </header>
      <Evidence evidence={exception.evidence} />
      {action ? <HeldAction action={action} unit={unit} /> : <Note>The held action could not be loaded.</Note>}
      {exception.status === "open" ? <AnswerForm exceptionId={exception.id} /> : <Answered exception={exception} />}
    </article>
  );
}

// EVIDENCE: the quote, a detail line and the domain paths involved (all optional)
function Evidence({ evidence }: { evidence: Tables<"exceptions">["evidence"] }) {
  const object = asObject(evidence);
  const quote = readString(object, "quote");
  const detail = readString(object, "detail");
  const domainPaths = readStrings(object, "domainPaths");
  return (
    <div className="flex flex-col gap-2">
      {quote ? <Quote>{quote}</Quote> : null}
      {detail ? <p className="text-panel text-muted-foreground">{detail}</p> : null}
      {domainPaths.length > 0 ? <p className="font-mono text-xs text-muted-foreground">{domainPaths.join(" · ")}</p> : null}
    </div>
  );
}

// HELD ACTION: what would change, next to the unit as it stands now
function HeldAction({ action, unit }: { action: Tables<"actions">; unit: UnitSummary | undefined }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <p className="text-xs text-faint uppercase">Held action</p>
        <ActionSummary action={action} />
      </div>
      {unit ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-faint uppercase">Current unit</p>
          <p className="text-panel">{unit.content}</p>
        </div>
      ) : null}
    </div>
  );
}

// ANSWERED: the decision, when, and the note
function Answered({ exception }: { exception: Tables<"exceptions"> }) {
  return (
    <Facts
      items={[
        ["Answered", <span key="at" className="font-mono">{formatDateTime(exception.resolved_at)}</span>],
        ["Note", exception.note ?? "—"],
      ]}
    />
  );
}
