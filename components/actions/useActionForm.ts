"use client";

import { type FormEvent, useState } from "react";
import type { CommitResult } from "@/lib/change-control/types";
import { submitEdit } from "@/lib/server-actions/knowledge";
import { type ActionFormValues, type ActionMode, type ActionTarget, buildPersonAction, initialValues, validateValues } from "./buildAction";
import { useServerAction } from "./useServerAction";

export type ActionForm = {
  values: ActionFormValues;
  set: <K extends keyof ActionFormValues>(key: K, value: ActionFormValues[K]) => void;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  isPending: boolean;
  error: string | null;
  // set when Change control did not apply everything (rejected, or sent to Exceptions)
  outcome: CommitResult | null;
};

// ACTION FORM STATE: values, validation, and the submitEdit call; closes via `onApplied`
export function useActionForm(mode: ActionMode, target: ActionTarget, onApplied: () => void): ActionForm {
  const [values, setValues] = useState(() => initialValues(target));
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CommitResult | null>(null);
  const edit = useServerAction(submitEdit);

  const set: ActionForm["set"] = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = validateValues(mode, target, values);
    setProblem(invalid);
    if (invalid) return;
    const result = await edit.run(buildPersonAction(mode, target, values));
    if (!result.ok) return;
    if (result.status === "applied") onApplied();
    else setOutcome(result);
  };

  return { values, set, submit, isPending: edit.isPending, error: problem ?? edit.error, outcome };
}
