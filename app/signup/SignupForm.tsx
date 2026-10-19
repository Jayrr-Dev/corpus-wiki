"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp, type SignUpState } from "@/lib/auth/signup";

const initial: SignUpState = { error: null, message: null };
async function submit(previous: SignUpState, form: FormData): Promise<SignUpState> {
  try { return await signUp(previous, form); }
  catch (error) {
    if (error instanceof TypeError) return { error: "Can't reach the account service. Please try again.", message: null };
    throw error;
  }
}

export function SignupForm() {
  const [state, action, pending] = useActionState(submit, initial);
  return <form action={action} className="flex flex-col gap-3">
    <div className="flex flex-col gap-1.5"><Label htmlFor="name">Your name <span className="text-muted-foreground">(optional)</span></Label><Input id="name" name="name" autoComplete="name" maxLength={80} disabled={pending} /></div>
    <div className="flex flex-col gap-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required disabled={pending} /></div>
    <div className="flex flex-col gap-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required disabled={pending} /><p className="text-xs text-muted-foreground">At least 8 characters.</p></div>
    <div className="flex flex-col gap-1.5"><Label htmlFor="confirmation">Confirm password</Label><Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} required disabled={pending} /></div>
    {state.error ? <p role="alert" className="text-panel text-destructive">{state.error}</p> : null}
    {state.message ? <p role="status" className="text-panel text-muted-foreground">{state.message}</p> : null}
    <Button type="submit" disabled={pending || !!state.message}>{pending ? "Creating account…" : "Create account"}</Button>
  </form>;
}
