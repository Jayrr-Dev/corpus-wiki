import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";

// ADMIN CLIENT (SECRET KEY): bypasses RLS. Server code only: the `server-only`
// import makes any client-side import fail the build, so the key never reaches a browser.
// Knowledge tables are still written only through Change control (commit_change_set).
export type AdminSupabase = SupabaseClient<Database>;

let adminClient: AdminSupabase | undefined;

// Returns one shared admin client; throws when SUPABASE_SECRET_KEY is not set
export function getAdminSupabase(): AdminSupabase {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (server env).");
  }
  adminClient = createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}
