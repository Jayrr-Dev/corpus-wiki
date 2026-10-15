"use client";

import { useEffect, useRef } from "react";
import { refreshPendingStaleSections } from "@/lib/server-actions/pages";

// Starts pending section rewrites from any signed-in screen, once per visit.
export function PendingStaleRefresh() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void refreshPendingStaleSections();
  }, []);
  return null;
}
