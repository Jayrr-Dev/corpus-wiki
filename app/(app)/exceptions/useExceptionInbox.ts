"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { CATEGORY_OF_REASON, type CategoryTab } from "./categories";
import type { Tables } from "@/lib/database/types";
import { useActiveSpace } from "@/components/shell/SpaceProvider";

export const INBOX_PAGE_SIZE = 25;
export type InboxStatus = "open" | "answered";
export type InboxRow = { exception: Tables<"exceptions">; action: Tables<"actions"> | undefined };

export function useExceptionInbox(status: InboxStatus, category: CategoryTab, page: number, search: string, oldestFirst: boolean) {
  const space = useActiveSpace();
  return useQuery({
    queryKey: ["table", "exceptions", "inbox", status, category, page, search, oldestFirst, space.id],
    queryFn: async () => {
      const client = getBrowserSupabase();
      let query = client.from("exceptions").select("*", { count: "exact" }).filter("space_id", "eq", space.id);
      query = status === "open" ? query.eq("status", "open") : query.neq("status", "open");
      if (category !== "all") query = query.in("reason", Object.entries(CATEGORY_OF_REASON).filter(([, value]) => value === category).map(([reason]) => reason as Tables<"exceptions">["reason"]));
      if (search.trim()) {
        // Quote the PostgREST value and escape wildcard characters: search is literal text.
        const pattern = JSON.stringify("%" + search.trim().replace(/[\\%_]/g, "\\$&") + "%");
        query = query.or(`evidence->>detail.ilike.${pattern},evidence->>quote.ilike.${pattern},evidence->>domainPaths.ilike.${pattern},note.ilike.${pattern}`);
      }
      const { data, count, error } = await query.order("created_at", { ascending: oldestFirst }).order("id", { ascending: oldestFirst })
        .range(page * INBOX_PAGE_SIZE, (page + 1) * INBOX_PAGE_SIZE - 1);
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((row) => row.action_id))];
      const actions = ids.length ? await client.from("actions").select("*").in("id", ids) : { data: [], error: null };
      if (actions.error) throw actions.error;
      const actionById = new Map((actions.data ?? []).map((action) => [action.id, action]));
      return { rows: (data ?? []).map((exception): InboxRow => ({ exception, action: actionById.get(exception.action_id) })), count: count ?? 0 };
    },
  });
}

export function useExceptionCounts() {
  const space = useActiveSpace();
  return useQuery({
    queryKey: ["table", "exceptions", "inbox-counts", space.id],
    queryFn: async () => {
      const client = getBrowserSupabase();
      const [open, answered] = await Promise.all([
        client.from("exceptions").select("id", { count: "exact", head: true }).filter("space_id", "eq", space.id).eq("status", "open"),
        client.from("exceptions").select("id", { count: "exact", head: true }).filter("space_id", "eq", space.id).neq("status", "open"),
      ]);
      if (open.error) throw open.error;
      if (answered.error) throw answered.error;
      return { open: open.count ?? 0, answered: answered.count ?? 0 };
    },
  });
}

// OPEN COUNT ONLY: the sidebar badge on every screen needs just this one number
export function useOpenExceptionCount(): number {
  const space = useActiveSpace();
  return useQuery({
    queryKey: ["table", "exceptions", "open-count", space.id],
    queryFn: async () => {
      const { count, error } = await getBrowserSupabase().from("exceptions").select("id", { count: "exact", head: true })
        .filter("space_id", "eq", space.id).eq("status", "open");
      if (error) throw error;
      return count ?? 0;
    },
  }).data ?? 0;
}
