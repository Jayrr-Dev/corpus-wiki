"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { resetRequestActor } from "@/lib/auth/currentPerson";
import { SPACE_COOKIE } from "@/lib/spaces/shared";
import { safeNextPath } from "./paths";

// LOGIN FORM STATE: the error message to show, if any
export type SignInState = { error: string | null };

// Signs in with email + password, then goes to the page the user wanted
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const connectionFailed = error.name === "AuthRetryableFetchError" || /fetch failed|failed to fetch|network|load failed/i.test(error.message);
    return { error: connectionFailed
      ? "Can't connect to the sign-in service right now. Please try again in a moment."
      : error.message };
  }
  (await cookies()).delete(SPACE_COOKIE);
  await resetRequestActor();
  redirect(next);
}

// Signs out and returns to the login page
export async function signOut(): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error(error.message);
  (await cookies()).delete(SPACE_COOKIE);
  await resetRequestActor();
  redirect("/login");
}
