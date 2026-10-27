"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Tabs } from "radix-ui";
import { UploaderName } from "@/app/(app)/_components/ActorName";
import { ErrorNote, Section, TextLink } from "@/app/(app)/_components/bits";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { textColumn } from "@/app/(app)/_components/columns";
import { readsState } from "@/app/(app)/_lib/reads";
import { EVENT_TONE, SOURCE_STATE_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { UploadIcon } from "@/components/icons";
import type { Tables } from "@/lib/database/types";
import { sourceState } from "@/lib/knowledge/evidence";
import { latestUploads } from "@/lib/ingest/latestUploads";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { queryKeys, useShiftEvents } from "@/lib/queries";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import { useRowsByIds } from "@/lib/queries/screens";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { SourceRowMenu } from "@/app/(app)/sources/SourceRowMenu";
import { UploadWorkflowActions, UploadWorkflowBatch, UploadWorkflowStatus } from "@/components/upload/UploadWorkflowStatus";
import { RetryUploadButton } from "./RetryUploadButton";

// ONE ROW: the upload event with its source and change set
type UploadRow = Tables<"shift_events"> & { sourceTitle: string; source: Tables<"sources"> | null; changeSetId: string | null };

// COLUMNS: file (with its change set), status (with its error), who uploaded it and when, then the source's "…" menu
const COLUMNS = [
  { ...textColumn<UploadRow>("source", "File", (row) => row.sourceTitle, (row) => (
    <div className="flex flex-col gap-1 whitespace-normal">
      {row.source ? (
        <TextLink href={`/sources/${row.source.id}`} className="font-medium break-words">{row.sourceTitle}</TextLink>
      ) : (
        <span className="text-faint">{row.sourceTitle}</span>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {row.source && sourceState(row.source) !== "active" ? <StatusDot tone={SOURCE_STATE_TONE[sourceState(row.source)]} label={sourceState(row.source)} /> : null}
        {row.changeSetId ? <TextLink href={`/changes/${row.changeSetId}`}>View change set</TextLink> : null}
      </div>
    </div>
  )), meta: { cellClassName: "w-2/5 max-w-0 min-w-40 py-3 align-top" } },
  { ...textColumn<UploadRow>("status", "Status", (row) => `${row.status} ${row.error ?? ""}`, (row) => (
    row.source?.origin === "internal" ? <UploadWorkflowStatus eventId={row.id} allowRetry={!row.source.archived_at} legacyStatus={row.status} legacyError={row.error} compact /> : (
      <div className="flex flex-col gap-1.5 whitespace-normal">
        <StatusDot
          tone={EVENT_TONE[row.status]}
          label={row.status === "reconciling" ? "Processing" : row.status}
          busy={row.status === "received" || row.status === "extracting" || row.status === "reconciling" || row.status === "checking"}
          className="font-medium"
        />
        {row.error ? <ErrorNote error={row.error.startsWith("The model's answer did not match the expected shape:")
          ? "The AI returned invalid claim fields. Resume processing to try again; no knowledge from this answer was saved."
          : row.error} /> : null}
      </div>
    )
  )), meta: { cellClassName: "w-2/5 max-w-0 min-w-40 py-3 align-top" } },
  { ...textColumn<UploadRow>("created", "Uploaded", (row) => row.created_at, (row) => (
    <div className="flex flex-col gap-0.5 whitespace-nowrap">
      {row.source?.origin === "external" ? <span>AI</span> : <UploaderName event={row} />}
      <span className="font-mono text-xs text-muted-foreground"><DateTime iso={row.created_at} /></span>
    </div>
  )), meta: { cellClassName: "py-3 align-top" } },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    meta: { cellClassName: "py-3 align-top" },
    cell: ({ row }) => (
      <div className="flex items-start justify-end gap-2">
        {row.original.source?.origin === "internal" ? <UploadWorkflowActions eventId={row.original.id} allowRetry={!row.original.source.archived_at} legacyStatus={row.original.status} /> : null}
        {row.original.source?.origin === "external" && !row.original.source.archived_at && row.original.status === "failed" ? <RetryUploadButton eventId={row.original.id} /> : null}
        {row.original.source ? <SourceRowMenu source={row.original.source} /> : null}
      </div>
    ),
  },
] satisfies ColumnDef<UploadRow, unknown>[];

// RECENT UPLOADS: one row per stored file, showing its latest run, newest first
export function RecentUploads() {
  const [origin, setOrigin] = useState("internal");
  const query = useUploadRows();
  const data = useMemo(() => query.data.filter((row) => (row.source?.origin ?? "internal") === origin), [query.data, origin]);
  const counts = { internal: 0, external: 0 };
  for (const row of query.data) counts[row.source?.origin === "external" ? "external" : "internal"] += 1;
  // Every internal row's workflow in one read, not one per row
  const workflowIds = useMemo(() => query.data.filter((row) => row.source?.origin === "internal").map((row) => row.id), [query.data]);
  return (
    <UploadWorkflowBatch eventIds={workflowIds}>
      <Section title="Recent uploads">
        <Tabs.Root value={origin} onValueChange={setOrigin} className="space-y-4">
          <Tabs.List aria-label="Upload source origin" className="flex gap-1 border-b">
            {(["internal", "external"] as const).map((value) => (
              <Tabs.Trigger key={value} value={value} className={cn("border-b-2 px-3 py-2 text-panel transition-colors", origin === value ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {value === "internal" ? "Internal" : "External"}
                <span className="ml-1.5 font-mono text-xs text-faint">{counts[value]}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value={origin}>
            <DataTable
              key={origin}
              query={{ ...query, data }}
              columns={COLUMNS}
              getRowId={(row) => row.id}
              pageSize={10}
              filterPlaceholder="Search uploads…"
              emptyState={<EmptyState icon={UploadIcon} title={`No ${origin} uploads yet`} />}
            />
          </Tabs.Content>
        </Tabs.Root>
      </Section>
    </UploadWorkflowBatch>
  );
}

// The change set of each listed upload: only those rows and the two columns the table links with
function useUploadChangeSets(eventIds: string[]) {
  const ids = [...new Set(eventIds)].sort();
  return useQuery({
    queryKey: [...queryKeys.table("change_sets"), "events", ids],
    queryFn: () => readIdBatches(ids, (batch) => readPages((from, to) =>
      getBrowserSupabase().from("change_sets").select("id, event_id").in("event_id", batch).order("created_at", { ascending: false }).order("id").range(from, to))),
    enabled: ids.length > 0,
  });
}

// Upload events joined to their source titles and change sets
function useUploadRows() {
  const events = useShiftEvents({ filters: { cause: "upload" } });
  const latest = useMemo(() => latestUploads(events.data ?? []), [events.data]);
  const sources = useRowsByIds("sources", latest.map((event) => event.source_id));
  const changeSets = useUploadChangeSets(latest.map((event) => event.id));
  const data = useMemo(() => {
    const sourceById = new Map((sources.data ?? []).map((source) => [source.id, source]));
    // Same order as the whole-table read had, so an event with several change sets links the same one
    const changeByEvent = new Map((changeSets.data ?? []).map((changeSet) => [changeSet.event_id, changeSet.id]));
    // An upload whose file was deleted or purged is history, not an upload: Changes keeps it
    return latest.map((event) => ({
      ...event,
      sourceTitle: sourceById.get(event.source_id ?? "")?.title ?? "—",
      source: sourceById.get(event.source_id ?? "") ?? null,
      changeSetId: changeByEvent.get(event.id) ?? null,
    }));
  }, [latest, sources.data, changeSets.data]);
  // No listed uploads means no change sets to read (the read stays idle, not pending)
  return { data, ...readsState(latest.length ? [events, sources, changeSets] : [events, sources]) };
}
