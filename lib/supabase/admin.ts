import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentActor } from "@/lib/auth/currentPerson";
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
    global: { fetch: fetchAsPerson },
  });
  return adminClient;
}

// WHO IS ACTING: each call carries the signed-in person and where the request came
// from, so the database can name them on the rows it writes
// (supabase/migrations/20261031000000_profiles.sql)
async function fetchAsPerson(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { personId, via } = await currentActor();
  const headers = new Headers(init?.headers);
  if (personId) headers.set("x-person-id", personId);
  headers.set("x-via", via);
  return fetch(input, { ...init, headers });
}
