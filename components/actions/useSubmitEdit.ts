"use client";

import { useState } from "react";
import type { CommitResult, PersonAction } from "@/lib/change-control/types";
import { submitEdit } from "@/lib/server-actions/knowledge";
import { useServerAction } from "./useServerAction";

export type SubmitEdit = { submit: (action: PersonAction) => Promise<void>; isPending: boolean; error: string | null };

// Why an edit that reached Change control did not simply apply
function outcomeMessage(result: CommitResult): string {
  if (result.status === "rejected") return "The checks rejected this change. Open Changes to see why.";
  return `${result.exceptions} part(s) wait in Exceptions.`;
}

// SUBMIT ONE TYPED ACTION through Change control; closes via `onApplied` when it applied,
// otherwise says why (the checks rejected it, or it waits in Exceptions)
export function useSubmitEdit(onApplied: () => void): SubmitEdit {
  const edit = useServerAction(submitEdit, { progress: { title: "Saving your change", detail: "Updating affected articles…", delayMs: 800 } });
  const [outcome, setOutcome] = useState<string | null>(null);
  const submit = async (action: PersonAction) => {
    setOutcome(null);
    const result = await edit.run(action);
    if (!result.ok) return;
    if (result.status === "applied") onApplied();
    else setOutcome(outcomeMessage(result));
  };
  return { submit, isPending: edit.isPending, error: edit.error ?? outcome };
}
