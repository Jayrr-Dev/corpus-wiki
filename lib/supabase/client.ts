"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import { getPublicSupabaseEnv } from "./env";
import { SPACE_COOKIE } from "@/lib/spaces/shared";

// BROWSER CLIENT: publishable key + the user's session. RLS makes it read-only;
// every write goes through server code (server actions / route handlers).
export type BrowserSupabase = SupabaseClient<Database>;

let browserClient: BrowserSupabase | undefined;

// Returns one shared client per tab, so Realtime channels and auth state are not duplicated
export function getBrowserSupabase(): BrowserSupabase {
  if (browserClient) return browserClient;
  const { url, publishableKey } = getPublicSupabaseEnv();
  browserClient = createBrowserClient<Database>(url, publishableKey, {
    global: { fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      const selected = document.cookie.split("; ").find((part) => part.startsWith(`${SPACE_COOKIE}=`))?.split("=")[1];
      if (selected) headers.set("x-space-id", decodeURIComponent(selected));
      return fetch(input, { ...init, headers });
    } },
  });
  return browserClient;
}
