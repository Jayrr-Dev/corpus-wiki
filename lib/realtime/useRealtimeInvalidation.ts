"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import { queryKeys, type TableName } from "@/lib/queries";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { coalesceInvalidation } from "./coalesce";
import { SPACE_COOKIE } from "@/lib/spaces/shared";
import { subscriptionFallback } from "./subscriptionFallback";

// =====================================================================
// REALTIME -> TANSTACK QUERY: when a row of `table` changes (optionally
// only rows matching a Realtime `filter` such as "page_id=eq.<id>"),
// every cached read of that table is invalidated and refetched, so open
// screens redraw after a commit without polling. The channel is removed
// on unmount or when the table or filter changes.
// =====================================================================

export type RealtimeInvalidationOptions = { filter?: string; enabled?: boolean };

// Subscribes to one table's changes and invalidates its queries on each one
export function useRealtimeInvalidation(table: TableName, { filter, enabled = true }: RealtimeInvalidationOptions = {}): void {
  const queryClient = useQueryClient();
  // Unique per hook instance, so two screens on the same table never share (and close) one channel
  const instanceId = useId();

  useEffect(() => {
    if (!enabled) return;
    const supabase = getBrowserSupabase();
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.table(table) });
    const updates = coalesceInvalidation(queryClient, table, invalidate);
    const fallback = subscriptionFallback(() => updates.trigger(), () => document.visibilityState !== "hidden");
    const channel = supabase
      .channel(`invalidate:${table}:${filter ?? "all"}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, (payload) => {
        const selected = document.cookie.split("; ").find((part) => part.startsWith(`${SPACE_COOKIE}=`))?.split("=")[1];
        const row = payload.new as Record<string, unknown>;
        if (selected && row.space_id && row.space_id !== selected) return;
        updates.trigger();
      })
      .subscribe(fallback.status);
    return () => {
      fallback.dispose();
      updates.dispose();
      void supabase.removeChannel(channel);
    };
  }, [queryClient, table, filter, enabled, instanceId]);
}
