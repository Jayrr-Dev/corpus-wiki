import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";

// GUARD FOR SERVER ACTIONS: they write with the secret key, so each one first
// checks that the caller is signed in (the proxy only guards page loads)
export async function requireUser(): Promise<void> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) throw new Error("Not signed in.");
}
