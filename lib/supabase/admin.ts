import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentActor } from "@/lib/auth/currentPerson";
import type { Database } from "@/lib/database/types";
import { fetchDatabaseRead } from "@/lib/db/readFetch";

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
  const { personId, via, spaceId } = await currentActor();
  const headers = new Headers(init?.headers);
  if (personId) headers.set("x-person-id", personId);
  if (spaceId) headers.set("x-space-id", spaceId);
  headers.set("x-via", via);
  // A database call never waits forever: a hung connection becomes an error the upload
  // workflow records, so its run can be resumed. File transfers keep their own pace.
  const url = String(input instanceof Request ? input.url : input);
  const timeout = url.includes("/storage/v1/") ? null : AbortSignal.timeout(DATABASE_CALL_TIMEOUT_MS);
  const signal = timeout && init?.signal ? AbortSignal.any([init.signal, timeout]) : (timeout ?? init?.signal);
  return fetchDatabaseRead(input, { ...init, headers, ...(signal ? { signal } : {}) });
}

// HOW LONG ONE DATABASE CALL MAY TAKE (the slowest functions, a commit or a hierarchy pass, take seconds)
const DATABASE_CALL_TIMEOUT_MS = 60_000;
