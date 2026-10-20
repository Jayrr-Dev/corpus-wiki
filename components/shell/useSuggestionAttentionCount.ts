"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveSpace } from "@/components/shell/SpaceProvider";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useRealtimeInvalidation } from "@/lib/realtime/useRealtimeInvalidation";

const ATTENTION = ["pending", "accepting", "failed", "stale"] as const;

// Open suggestions, including one that is applying. The count drops when it is applied.
export function useSuggestionAttentionCount(): number | null {
  const space = useActiveSpace();
  useRealtimeInvalidation("article_suggestions");
  const query = useQuery({
    queryKey: ["table", "article_suggestions", "attention", space.id],
    queryFn: async () => {
      const { count, error } = await getBrowserSupabase().from("article_suggestions").select("id", { count: "exact", head: true })
        .eq("space_id", space.id).in("status", [...ATTENTION]);
      if (error) throw error;
      return count ?? 0;
    },
  });
  return query.data ?? null;
}
