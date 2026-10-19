"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { exceptionTitle } from "@/app/(app)/exceptions/ExceptionCard";
import { ExceptionDialog } from "@/app/(app)/exceptions/ExceptionDialog";
import { useExceptionData } from "@/app/(app)/exceptions/ExceptionsScreen";
import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { proposerRoleName } from "@/app/(app)/decisions/describeDecision";
import { asObject, describeActionInput, readString } from "@/app/(app)/_lib/format";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/standard/tooltip";
import { useExceptions } from "@/lib/queries";
import { useRowsByIds } from "@/lib/queries/screens";
import { useRealtimeInvalidation } from "@/lib/realtime/useRealtimeInvalidation";
import { answerException } from "@/lib/server-actions/knowledge";
import type { Tables } from "@/lib/database/types";
import { useActiveSpace } from "@/components/shell/SpaceProvider";

// Mounted in the signed-in layout so questions appear wherever the user is working.
export function ExceptionNotifications() {
  const space = useActiveSpace();
  const data = useExceptionData({ filters: { status: "open" }, limit: 50 });
  const exceptions = useExceptions({ filters: { status: "open" }, limit: 50 });
  const refetch = exceptions.refetch;
  const [dismissed, setDismissed] = useState(() => new Set<string>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useRealtimeInvalidation("exceptions");
  // Reconnects and installations without realtime publication still receive questions.
  useEffect(() => {
    const timer = window.setInterval(() => void refetch(), 15000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  // Approval requests are persistent UI, independent of toast timers and limits.
  // Only an explicit decision writes an answer; hiding a card leaves it open.
  // Also guard rendering against stale or incorrectly scoped responses.
  const scopedExceptions = data.exceptions.filter((exception) => "space_id" in exception && exception.space_id === space.id);
  const queue = scopedExceptions
    .filter((exception) => exception.status === "open" && !dismissed.has(exception.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const current = queue[0];
  const currentAction = current ? data.actionById.get(current.action_id) : undefined;
  const changeSets = useRowsByIds("change_sets", [currentAction?.change_set_id]);
  const currentChangeSet = changeSets.data?.find((changeSet) => changeSet.id === currentAction?.change_set_id);
  const hide = (id: string) => setDismissed((previous) => new Set(previous).add(id));

  const selected = scopedExceptions.find((exception) => exception.id === selectedId);
  const action = selected ? data.actionById.get(selected.action_id) : undefined;
  const unit = action && UNIT_ACTION_TYPES.has(action.type) ? data.unitById.get(action.target_id ?? "") : undefined;
  return <>
    {current && <aside aria-label="Pending approvals" className="fixed top-4 right-4 z-40 max-w-[calc(100vw-2rem)] sm:top-6 sm:right-6">
      <ExceptionToast key={current.id} exception={current} remaining={queue.length}
        title={exceptionTitle(current, currentAction)} sender={proposerRoleName(currentChangeSet, currentAction?.type)}
        proposal={currentAction ? describeActionInput(currentAction.type, currentAction.input) : null}
        onView={() => setSelectedId(current.id)} onClose={() => hide(current.id)} />
    </aside>}
    <ExceptionDialog exception={selected} action={action} unit={unit} before={action && selected?.status !== "open" ? data.textsOf(action).before : null} onClose={() => setSelectedId(null)} />
  </>;
}

function ExceptionToast({ exception, remaining, title, sender, proposal, onView, onClose }: { exception: Tables<"exceptions">; remaining: number; title: string; sender: string | null; proposal: string | null; onView: () => void; onClose: () => void }) {
  const answer = useServerAction(answerException, { progress: false });
  const sending = useRef(false);
  const [note, setNote] = useState("");
  const detail = readString(asObject(exception.evidence), "detail");
  const decide = async (accept: boolean) => {
    if (sending.current) return;
    sending.current = true;
    try {
      const result = await answer.run(exception.id, accept, note.trim() || null);
      if (result.ok) onClose();
    } finally { sending.current = false; }
  };
  return <section className="flex max-h-[calc(100dvh-3rem)] w-96 max-w-full flex-col overflow-hidden rounded-xl border bg-background text-panel text-foreground shadow-lg" aria-label="Approval request">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <p className="font-medium">{sender ? <>The <span className="text-needs-you">{sender}</span> wants approval</> : "Needs approval"} <span className="ml-2 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{remaining}</span></p>
      <Tooltip content="Dismiss notification"><Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Dismiss approval notification" disabled={answer.isPending} onClick={onClose}><X /></Button></Tooltip>
    </header>
    <div className="min-h-0 space-y-3 overflow-y-auto px-4 py-4 leading-relaxed">
      <h2 className="font-semibold">{title}</h2>
      {detail && !detail.startsWith("# ") && <p className="break-words text-muted-foreground">{detail}</p>}
      {proposal && proposal !== detail && <div className="space-y-1 rounded-lg bg-muted/50 p-3"><p className="text-xs font-medium text-muted-foreground">Proposed change</p><p className="break-words">{proposal}</p></div>}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />Add details (optional)
        </summary>
        <Textarea className="mt-2" aria-label="Details to steer this decision (optional)" placeholder="e.g. Keep the citation in both places" maxLength={2000}
          value={note} disabled={answer.isPending} onChange={(event) => setNote(event.target.value)} />
      </details>
      {answer.error && <p className="text-failed" role="alert">{answer.error}</p>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <Button variant="ghost" size="sm" onClick={onView}>View details</Button>
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={answer.isPending} onClick={() => void decide(false)}>Reject</Button>
        <Button disabled={answer.isPending} onClick={() => void decide(true)}>Approve</Button>
      </div>
    </footer>
  </section>;
}
