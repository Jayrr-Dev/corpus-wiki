import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";

// GUARD FOR SERVER ACTIONS: they write with the secret key, so each one first
// checks that the caller is signed in (the proxy only guards page loads)
export async function requireUser(): Promise<{ id: string; email: string | null }> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims?.sub !== "string") throw new Error("Not signed in.");
  return { id: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : null };
}
