"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { readPages } from "@/lib/queries/batched";
import { canResumeUpload, isRunning, type UploadWorkflow } from "@/lib/ingest/workflowTypes";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Slow on purpose: this runs behind every screen (the sidebar badge), not just the upload being watched
const POLL_MS = 30_000;
// Faster while a run is live, so its row leaves "Processing" soon after it finishes
const BUSY_POLL_MS = 5_000;

type SourceRuns = { processing: Set<string>; unfinished: Set<string> };

// UNFINISHED SOURCES: active internal sources whose latest upload stopped before it finished and can be resumed.
// The same rule the source page uses to offer "Resume unfinished work".
export function useUnfinishedSources(): Set<string> {
  return useSourceRuns().unfinished;
}

// SOURCE RUNS: active internal sources whose latest upload is being worked on right now (processing),
// or stopped before it finished and can be resumed (unfinished)
export function useSourceRuns(): SourceRuns {
  // Only the ids and links the badge needs, filtered in the query: this runs behind every
  // screen, so it never loads whole tables. Keys stay under ["table", <table>] so Realtime
  // invalidation of either table still refreshes it.
  const sources = useQuery({
    queryKey: ["table", "sources", "active-internal-ids"],
    queryFn: () => readPages<{ id: string }>((from, to) => getBrowserSupabase().from("sources").select("id")
      .eq("origin", "internal").is("archived_at", null).is("replaced_by_id", null).order("id").range(from, to)),
  }).data;
  const uploads = useQuery({
    queryKey: ["table", "shift_events", "upload-runs"],
    queryFn: () => readPages<{ id: string; source_id: string | null }>((from, to) => getBrowserSupabase().from("shift_events").select("id,source_id")
      .eq("cause", "upload").not("source_id", "is", null).order("created_at", { ascending: false }).order("id").range(from, to)),
  }).data;
  // Newest first, so the first upload seen per source is its latest run
  const latestEventBySource = useMemo(() => {
    const active = new Set((sources ?? []).map((source) => source.id));
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
    refetchInterval: (query) => (query.state.data?.some(isRunning) ? BUSY_POLL_MS : POLL_MS),
  }).data;
  return useMemo(() => {
    const sourcesWith = (test: (workflow: UploadWorkflow) => boolean) => {
      const events = new Set((workflows ?? []).filter(test).map((workflow) => workflow.event_id));
      return new Set([...latestEventBySource].filter(([, eventId]) => events.has(eventId)).map(([sourceId]) => sourceId));
    };
    return { processing: sourcesWith(isRunning), unfinished: sourcesWith(canResumeUpload) };
  }, [workflows, latestEventBySource]);
}
