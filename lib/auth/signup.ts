"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { resetRequestActor } from "@/lib/auth/currentPerson";
import { SPACE_COOKIE } from "@/lib/spaces/shared";

export type SignUpState = { error: string | null; message: string | null };

export async function signUp(_previous: SignUpState, form: FormData): Promise<SignUpState> {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!z.email().safeParse(email).success) return { error: "Enter a valid email address.", message: null };
  if (name.length > 80) return { error: "Keep your name under 80 characters.", message: null };
  if (password.length < 8) return { error: "Use at least 8 characters for your password.", message: null };
  if (password !== form.get("confirmation")) return { error: "The two passwords don't match.", message: null };
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (!origin || !/^https?:\/\//.test(origin)) return { error: "Open the sign-up page in your browser and try again.", message: null };
  const client = await getServerSupabase();
  const { data, error } = await client.auth.signUp({ email, password, options: {
    emailRedirectTo: new URL("/auth/callback", origin).href,
    ...(name ? { data: { full_name: name } } : {}),
  } });
  if (error) return { error: error.message, message: null };
  if (data.session) {
    (await cookies()).delete(SPACE_COOKIE);
    await resetRequestActor();
    redirect("/");
  }
  return { error: null, message: "Check your email to confirm your account, then sign in. If you already have an account, sign in with your existing password." };
}
