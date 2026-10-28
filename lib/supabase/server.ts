import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database/types";
import { getPublicSupabaseEnv } from "./env";
import { isSpaceId, SPACE_COOKIE } from "@/lib/spaces/shared";
import { currentAgentSession } from "@/lib/agents/session";
import { getAdminSupabase } from "./admin";

// SERVER CLIENT (USER SESSION): for Server Components, server actions and route
// handlers. Acts as the signed-in user, so RLS still applies (reads only).
export type ServerSupabase = SupabaseClient<Database>;

// Builds a client bound to this request's auth cookies
export async function getServerSupabase(): Promise<ServerSupabase> {
  // An agent request has no cookies. The admin client names the key's owner and
  // Space on every call, and the database limits it to that Space (lib/agents/session.ts)
  if (currentAgentSession()) return getAdminSupabase();
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicSupabaseEnv();
  const selected = cookieStore.get(SPACE_COOKIE)?.value;
  return createServerClient<Database>(url, publishableKey, {
    global: { headers: selected && isSpaceId(selected) ? { "x-space-id": selected } : {} },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        // Server Components cannot set cookies; the proxy refreshes the session instead
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* called from a Server Component: safe to ignore */
        }
      },
    },
  });
}
