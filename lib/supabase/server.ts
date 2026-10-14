import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database/types";
import { getPublicSupabaseEnv } from "./env";

// SERVER CLIENT (USER SESSION): for Server Components, server actions and route
// handlers. Acts as the signed-in user, so RLS still applies (reads only).
export type ServerSupabase = SupabaseClient<Database>;

// Builds a client bound to this request's auth cookies
export async function getServerSupabase(): Promise<ServerSupabase> {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicSupabaseEnv();
  return createServerClient<Database>(url, publishableKey, {
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
