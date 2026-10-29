"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "@/app/providers";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Keyed by space in the server layout: navigating between accounts cannot
// reuse the previous account's cached pages, uploads, or settings.
export function AccountDataProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    const client = getBrowserSupabase();
    let leaving = false;
    const check = (id: string | undefined) => {
      if (leaving || id === accountId) return;
      leaving = true;
      queryClient.clear();
      setSwitching(true);
      window.location.assign(new URL(id ? "/pages" : "/login", window.location.origin).href);
    };
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") check(session?.user.id);
    });
    // Server-side sign-in changes cookies without necessarily sending the
    // browser SDK's broadcast. Recheck when another tab becomes active.
    const focus = () => { void client.auth.getSession().then(({ data, error }) => { if (!error) check(data.session?.user.id); }); };
    window.addEventListener("focus", focus);
    // No cache clear here: a new space remounts with its own client anyway, and React's
    // dev double mount would otherwise wipe the cache and fetch every query twice
    return () => { data.subscription.unsubscribe(); window.removeEventListener("focus", focus); };
  }, [accountId, queryClient]);
  return switching ? <p className="p-6 text-muted-foreground">Switching accounts…</p> : <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
