"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { UploaderName } from "@/app/(app)/_components/ActorName";
import { Section, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { dateColumn, textColumn } from "@/app/(app)/_components/columns";
import { readsState } from "@/app/(app)/_lib/reads";
import { EVENT_TONE, SOURCE_STATE_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { UploadIcon } from "@/components/icons";
import type { Tables } from "@/lib/database/types";
import { sourceState } from "@/lib/knowledge/evidence";
import { useChangeSets, useShiftEvents } from "@/lib/queries";
import { useRowsByIds } from "@/lib/queries/screens";
import { SourceRowMenu } from "@/app/(app)/sources/SourceRowMenu";
import { RetryUploadButton } from "./RetryUploadButton";

// ONE ROW: the upload event with its source and change set
type UploadRow = Tables<"shift_events"> & { sourceTitle: string; source: Tables<"sources"> | null; changeSetId: string | null };

// COLUMNS: status, file, change set, error, who uploaded it and when, then Retry on a failed row and the source's "…" menu
const COLUMNS = [
  textColumn<UploadRow>("status", "Status", (row) => row.status, (row) => (
    <StatusDot
      tone={EVENT_TONE[row.status]}
      label={row.status === "reconciling" ? "Processing" : row.status}
      busy={row.status === "received" || row.status === "extracting" || row.status === "reconciling" || row.status === "checking"}
    />
  )),
  textColumn<UploadRow>("source", "File", (row) => row.sourceTitle, (row) =>
    row.source ? (
      <div className="flex w-56 flex-col gap-0.5">
        <TextLink href={`/sources/${row.source.id}`} className="whitespace-normal break-words">{row.sourceTitle}</TextLink>
        {sourceState(row.source) !== "active" ? (
          <StatusDot tone={SOURCE_STATE_TONE[sourceState(row.source)]} label={sourceState(row.source)} className="text-xs text-muted-foreground" />
        ) : null}
      </div>
    ) : (
      <span className="text-faint">{row.source_id ? row.sourceTitle : "Deleted file"}</span>
    ),
  ),
  textColumn<UploadRow>("change", "Change set", (row) => row.changeSetId ?? "", (row) =>
    row.changeSetId ? <TextLink href={`/changes/${row.changeSetId}`}>Open</TextLink> : <span className="text-faint">—</span>,
  ),
  textColumn<UploadRow>("error", "Error", (row) => row.error ?? "", (row) => <span className="block w-64 whitespace-normal break-words">{row.error ?? ""}</span>),
  textColumn<UploadRow>("by", "Uploaded by", (row) => row.person_id ?? row.via ?? "", (row) => <UploaderName event={row} />),
  dateColumn<UploadRow>("created", "Uploaded", (row) => row.created_at, true),
  {
    id: "actions",
    header: "",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex items-start justify-end gap-1">
        {row.original.status === "failed" ? <RetryUploadButton eventId={row.original.id} /> : null}
        {row.original.source ? <SourceRowMenu source={row.original.source} /> : null}
      </div>
    ),
  },
] satisfies ColumnDef<UploadRow, unknown>[];

// RECENT UPLOADS: shift events caused by an upload, newest first
export function RecentUploads() {
  const query = useUploadRows();
  return (
    <Section title="Recent uploads">
      <DataTable
        query={query}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        pageSize={10}
        filterPlaceholder="Search uploads…"
        emptyState={<EmptyState icon={UploadIcon} title="No uploads yet" />}
      />
    </Section>
  );
}

// Upload events joined to their source titles and change sets
function useUploadRows() {
  const events = useShiftEvents({ filters: { cause: "upload" }, limit: 50 });
  const sources = useRowsByIds("sources", (events.data ?? []).map((event) => event.source_id));
  const changeSets = useChangeSets();
  const data = useMemo(() => {
    const sourceById = new Map((sources.data ?? []).map((source) => [source.id, source]));
    const changeByEvent = new Map((changeSets.data ?? []).map((changeSet) => [changeSet.event_id, changeSet.id]));
    return (events.data ?? []).map((event) => ({
      ...event,
      sourceTitle: sourceById.get(event.source_id ?? "")?.title ?? "—",
      source: sourceById.get(event.source_id ?? "") ?? null,
      changeSetId: changeByEvent.get(event.id) ?? null,
    }));
  }, [events.data, sources.data, changeSets.data]);
  return { data, ...readsState([events, sources, changeSets]) };
}
