"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type ActionResult, describeCallError } from "@/lib/server-actions/result";

export type ServerActionState<A extends unknown[], R extends object> = {
  run: (...args: A) => Promise<ActionResult<R>>;
  isPending: boolean;
  error: string | null;
  reset: () => void;
};

// SERVER ACTION RUNNER: calls one server action, keeps its pending flag and
// `{ ok: false }` error for the screen, and refreshes every table read on success
export function useServerAction<A extends unknown[], R extends object>(
  action: (...args: A) => Promise<ActionResult<R>>,
): ServerActionState<A, R> {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (...args: A): Promise<ActionResult<R>> => {
    setIsPending(true);
    setError(null);
    const result = await callSafely(action, args);
    if (result.ok) await queryClient.invalidateQueries({ queryKey: ["table"] });
    else setError(result.error);
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
