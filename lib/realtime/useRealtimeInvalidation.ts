"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys, type TableName } from "@/lib/queries";
import { coalesceInvalidation } from "./coalesce";
import { steadyRefresh } from "./steadyRefresh";

// =====================================================================
// LIVE TABLES -> TANSTACK QUERY: every cached read of `table` is
// invalidated and refetched on a steady timer while the screen is shown,
// so open screens redraw after a commit.
// It no longer subscribes to Supabase Realtime "Postgres Changes": the
// service reads the database change log to serve it, and that reader
// crashed the OrioleDB server ("undo record was cleaned concurrently with
// the read", 2026-10-30). Broadcast channels (useSectionBuild) are unaffected.
// =====================================================================

// filter: kept for callers; every read of the table is refreshed
export type RealtimeInvalidationOptions = { filter?: string; enabled?: boolean };

// Refreshes one table's queries while the screen is open
export function useRealtimeInvalidation(table: TableName, { enabled = true }: RealtimeInvalidationOptions = {}): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.table(table) });
    const updates = coalesceInvalidation(queryClient, table, invalidate);
    const poll = steadyRefresh(() => updates.trigger(), () => document.visibilityState !== "hidden");
    return () => {
      poll.dispose();
      updates.dispose();
    };
  }, [queryClient, table, enabled]);
}
