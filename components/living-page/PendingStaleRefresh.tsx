"use client";

import { useEffect, useRef } from "react";
import { withProgress } from "@/components/toast";
import { refreshPendingStaleSections } from "@/lib/server-actions/pages";

// Starts pending section rewrites from any signed-in screen, once per visit.
// Nothing pending returns at once; real rewrites show a progress toast.
export function PendingStaleRefresh() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void withProgress("Updating stale articles", "Rewriting sections that cite changed knowledge…", () => refreshPendingStaleSections(), (result) => result.ok, { delayMs: 1500 }).catch(() => undefined);
  }, []);
  return null;
}
