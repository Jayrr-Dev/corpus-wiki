"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/queries/keys";
import { useRealtimeInvalidation } from "@/lib/realtime";

const SECTION_COLUMNS = "id,page_id,position,body,built_at,retired_at";
const SECTION_LIMIT = 1000;

// Table-prefixed keys participate in the app's existing change invalidation.
// Bounded previews; exact counts do not depend on the preview window.
export function useFrontPage() {
  useRealtimeInvalidation("pages");
  useRealtimeInvalidation("sections");
  useRealtimeInvalidation("lines");
  useRealtimeInvalidation("sources");
  const pages = useQuery({
    queryKey: [...queryKeys.table("pages"), "front-page"],
    queryFn: async () => {
      const { data, error, count } = await getBrowserSupabase().from("pages").select("*", { count: "exact" }).is("retired_at", null).order("created_at", { ascending: false }).order("id").limit(300);
      if (error) throw error;
      return { rows: data, count: count ?? data.length };
    },
  });
  // Every live section, read alongside pages instead of after them. Under the limit
  // it is the complete set, so it holds every section of the previewed pages; a
  // larger collection falls back to reading only the previewed pages' sections.
  const allSections = useQuery({
    queryKey: [...queryKeys.table("sections"), "front-page"],
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().from("sections").select(SECTION_COLUMNS).is("retired_at", null).order("position").order("id").limit(SECTION_LIMIT);
      if (error) throw error;
      return data;
    },
  });
  const truncated = allSections.isSuccess && allSections.data.length >= SECTION_LIMIT;
  const ids = (pages.data?.rows ?? []).map((page) => page.id).sort();
  const pageSections = useQuery({
    queryKey: [...queryKeys.table("sections"), "front-page", ids],
    enabled: pages.isSuccess && truncated,
    queryFn: async () => {
      if (!ids.length) return [];
      const { data, error } = await getBrowserSupabase().from("sections").select(SECTION_COLUMNS).in("page_id", ids).is("retired_at", null).order("position").order("id").limit(SECTION_LIMIT);
      if (error) throw error;
      return data;
    },
  });
  const sections = truncated ? pageSections : allSections;
  const changes = useQuery({
    queryKey: [...queryKeys.table("lines"), "front-page-activity"],
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().from("lines").select("section_id,last_changed_at").is("retired_at", null).order("last_changed_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });
  const sources = useQuery({
    queryKey: [...queryKeys.table("sources"), "front-page-media"],
    queryFn: async () => {
      const client = getBrowserSupabase();
      const [media, total] = await Promise.all([
        client.from("sources").select("id,title,mime_type,storage_path,url").is("archived_at", null).is("replaced_by_id", null).neq("storage_path", "").or("mime_type.like.image/%,mime_type.like.video/%").order("created_at", { ascending: false }).limit(24),
        client.from("sources").select("id", { count: "exact", head: true }).is("archived_at", null).is("replaced_by_id", null),
      ]);
      if (media.error) throw media.error;
      if (total.error) throw total.error;
      return { media: media.data, count: total.count ?? 0 };
    },
  });
  return { pages, sections, changes, sources };
}
