"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { startProgress } from "@/components/toast";
import { type ActionResult, describeCallError } from "@/lib/server-actions/result";

export type ServerActionState<A extends unknown[], R extends object> = {
  run: (...args: A) => Promise<ActionResult<R>>;
  isPending: boolean;
  error: string | null;
  reset: () => void;
};

// PROGRESS: a progress toast (with a loading bar) shows until the action finishes.
// Long-running actions name what they are doing and show at once (or after
// delayMs); every other action gets a generic toast only if it runs past
// UNNAMED_DELAY_MS. `false` turns it off (callers that show their own toast).
export type ActionProgress = { title: string; detail?: string; delayMs?: number };

const UNNAMED_DELAY_MS = 1500;
const UNNAMED_PROGRESS: ActionProgress = { title: "Still working…", detail: "Saving and updating affected pages…", delayMs: UNNAMED_DELAY_MS };

// SERVER ACTION RUNNER: calls one server action, keeps its pending flag and
// `{ ok: false }` error for the screen, and refreshes every table read on success
export function useServerAction<A extends unknown[], R extends object>(
  action: (...args: A) => Promise<ActionResult<R>>,
  options: { progress?: ActionProgress | false } = {},
): ServerActionState<A, R> {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (...args: A): Promise<ActionResult<R>> => {
    setIsPending(true);
    setError(null);
    const shown = options.progress === undefined ? UNNAMED_PROGRESS : options.progress;
    const progress = shown ? startProgress(shown.title, shown.detail, { delayMs: shown.delayMs }) : null;
    const result = await callSafely(action, args);
    if (result.ok) {
      progress?.update("Refreshing the page…");
      await queryClient.invalidateQueries({ queryKey: ["table"] });
      progress?.done();
    } else {
      progress?.fail();
      setError(result.error);
    }
    setIsPending(false);
    return result;
  };
  return { run, isPending, error, reset: () => setError(null) };
}

// A network failure rejects instead of returning { ok: false }; fold it into the same shape
async function callSafely<A extends unknown[], R extends object>(
  action: (...args: A) => Promise<ActionResult<R>>,
  args: A,
): Promise<ActionResult<R>> {
  try {
    return await action(...args);
  } catch (error) {
    return { ok: false, error: describeCallError(error) };
  }
}
