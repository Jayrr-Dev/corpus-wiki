"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useShiftEvents, useSources } from "@/lib/queries";
import { canResumeUpload, type UploadWorkflow } from "@/lib/ingest/workflowTypes";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Slow on purpose: this runs behind every screen (the sidebar badge), not just the upload being watched
const POLL_MS = 30_000;

// UNFINISHED SOURCES: active internal sources whose latest upload stopped before it finished and can be resumed.
// The same rule the source page uses to offer "Resume unfinished work".
export function useUnfinishedSources(): Set<string> {
  const sources = useSources().data;
  const uploads = useShiftEvents({ filters: { cause: "upload" } }).data;
  // Newest first, so the first upload seen per source is its latest run
  const latestEventBySource = useMemo(() => {
    const active = new Set((sources ?? []).filter((source) => source.origin === "internal" && !source.archived_at && !source.replaced_by_id).map((source) => source.id));
    const latest = new Map<string, string>();
    for (const event of uploads ?? []) if (event.source_id && active.has(event.source_id) && !latest.has(event.source_id)) latest.set(event.source_id, event.id);
    return latest;
  }, [sources, uploads]);
  const eventIds = [...latestEventBySource.values()].sort();
  const workflows = useQuery({
    queryKey: ["table", "upload_workflows", "unfinished", eventIds],
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().rpc("read_upload_workflows", { p_event_ids: eventIds });
      if (error) throw error;
      return data as unknown as UploadWorkflow[];
    },
    enabled: eventIds.length > 0,
    refetchInterval: POLL_MS,
  }).data;
  return useMemo(() => {
    const unfinishedEvents = new Set((workflows ?? []).filter(canResumeUpload).map((workflow) => workflow.event_id));
    return new Set([...latestEventBySource].filter(([, eventId]) => unfinishedEvents.has(eventId)).map(([sourceId]) => sourceId));
  }, [workflows, latestEventBySource]);
}
