"use client";

import { useActionState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type SignInState } from "@/lib/auth/actions";
import { describeCallError } from "@/lib/server-actions/result";

const INITIAL_STATE: SignInState = { error: null };

// Calls signIn; a server that can't be reached becomes a message instead of a crash.
// Only TypeErrors (failed fetch) are caught: the redirect after a good sign-in passes through.
async function signInSafely(previous: SignInState, formData: FormData): Promise<SignInState> {
  try {
    return await signIn(previous, formData);
  } catch (error) {
    if (error instanceof TypeError) return { error: describeCallError(error) };
    throw error;
  }
}

// LOGIN FORM: email + password, posted to the signIn server action
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(signInSafely, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <ErrorNote error={state.error} />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
