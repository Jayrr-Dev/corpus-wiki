"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

// LOGIN FORM STATE: the error message to show, if any
export type SignInState = { error: string | null };

// Signs in with email + password, then goes to the page the user wanted
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect(next);
}

// Signs out and returns to the login page
export async function signOut(): Promise<void> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

// Only same-site paths are allowed after login (blocks open redirects like "//evil.com")
function safeNextPath(value: FormDataEntryValue | null): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}
