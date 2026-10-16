"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { exceptionTitle } from "@/app/(app)/exceptions/ExceptionCard";
import { ExceptionDialog } from "@/app/(app)/exceptions/ExceptionDialog";
import { useExceptionData } from "@/app/(app)/exceptions/ExceptionsScreen";
import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { asObject, describeActionInput, readString } from "@/app/(app)/_lib/format";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/standard/tooltip";
import { useExceptions } from "@/lib/queries";
import { useRealtimeInvalidation } from "@/lib/realtime/useRealtimeInvalidation";
import { answerException } from "@/lib/server-actions/knowledge";
import type { Tables } from "@/lib/database/types";

// Mounted in the signed-in layout so questions appear wherever the user is working.
export function ExceptionNotifications() {
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
  const queue = data.exceptions
    .filter((exception) => exception.status === "open" && !dismissed.has(exception.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const current = queue[0];
  const currentAction = current ? data.actionById.get(current.action_id) : undefined;
  const hide = (id: string) => setDismissed((previous) => new Set(previous).add(id));

  const selected = data.exceptions.find((exception) => exception.id === selectedId);
  const action = selected ? data.actionById.get(selected.action_id) : undefined;
  const unit = action && UNIT_ACTION_TYPES.has(action.type) ? data.unitById.get(action.target_id ?? "") : undefined;
  return <>
    {current && <aside aria-label="Pending approvals" className="fixed bottom-6 left-4 z-40 sm:left-10">
      <ExceptionToast key={current.id} exception={current} remaining={queue.length}
        title={exceptionTitle(current, currentAction)}
        proposal={currentAction ? describeActionInput(currentAction.type, currentAction.input) : null}
        onView={() => setSelectedId(current.id)} onClose={() => hide(current.id)} />
    </aside>}
    <ExceptionDialog exception={selected} action={action} unit={unit} before={action && selected?.status !== "open" ? data.textsOf(action).before : null} onClose={() => setSelectedId(null)} />
  </>;
}

function ExceptionToast({ exception, remaining, title, proposal, onView, onClose }: { exception: Tables<"exceptions">; remaining: number; title: string; proposal: string | null; onView: () => void; onClose: () => void }) {
  const answer = useServerAction(answerException, { progress: false });
  const sending = useRef(false);
  const detail = readString(asObject(exception.evidence), "detail");
  const decide = async (accept: boolean) => {
    if (sending.current) return;
    sending.current = true;
    try {
      const result = await answer.run(exception.id, accept, null);
      if (result.ok) onClose();
    } finally { sending.current = false; }
  };
  return <div className="relative isolate w-80 max-w-[calc(100vw-2rem)] pt-3">
    {remaining > 2 && <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-0 bottom-3 -z-20 rounded-md border bg-background shadow-sm" />}
    {remaining > 1 && <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 top-1.5 bottom-1.5 -z-10 rounded-md border bg-background shadow-sm" />}
    <div className="rounded-md border bg-background p-3 text-panel text-foreground shadow-lg" role="status">
    <p className="mb-2 text-xs text-muted-foreground">{remaining} {remaining === 1 ? "approval" : "approvals"} remaining</p>
    <div className="flex items-start justify-between gap-2">
      <div><p className="text-xs text-muted-foreground">AI needs your approval</p><p className="mt-1 font-medium">{title}</p></div>
      <Tooltip content="Hide this card; it stays in Needs review"><Button variant="ghost" size="icon-sm" aria-label="Hide approval card" disabled={answer.isPending} onClick={onClose}><X /></Button></Tooltip>
    </div>
    {detail && !detail.startsWith("# ") && <p className="mt-2 line-clamp-3 text-muted-foreground">{detail}</p>}
    {proposal && <p className="mt-2 line-clamp-3">{proposal}</p>}
    {answer.error && <p className="mt-2 text-failed" role="alert">{answer.error}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <Button disabled={answer.isPending} onClick={() => void decide(true)}>Approve</Button>
      <Button variant="outline" disabled={answer.isPending} onClick={() => void decide(false)}>Reject</Button>
      <Button variant="ghost" onClick={onView}>View exception</Button>
    </div>
    </div>
  </div>;
}
