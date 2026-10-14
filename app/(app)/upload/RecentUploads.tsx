"use client";

import { useMemo } from "react";
import { Section, TextLink } from "@/app/(app)/_components/bits";
import { dateColumn, statusColumn, textColumn } from "@/app/(app)/_components/columns";
import { readsState } from "@/app/(app)/_lib/reads";
import { EVENT_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { UploadIcon } from "@/components/icons";
import type { Tables } from "@/lib/database/types";
import { useChangeSets, useShiftEvents } from "@/lib/queries";
import { useRowsByIds } from "@/lib/queries/screens";

// ONE ROW: the upload event with its source and change set
type UploadRow = Tables<"shift_events"> & { sourceTitle: string; changeSetId: string | null };

// COLUMNS: status, file, change set, when
const COLUMNS = [
  statusColumn<UploadRow, UploadRow["status"]>("Status", (row) => row.status, EVENT_TONE),
  textColumn<UploadRow>("source", "File", (row) => row.sourceTitle, (row) =>
    row.source_id ? <TextLink href={`/sources/${row.source_id}`}>{row.sourceTitle}</TextLink> : row.sourceTitle,
  ),
  textColumn<UploadRow>("change", "Change set", (row) => row.changeSetId ?? "", (row) =>
    row.changeSetId ? <TextLink href={`/changes/${row.changeSetId}`}>Open</TextLink> : <span className="text-faint">—</span>,
  ),
  textColumn<UploadRow>("error", "Error", (row) => row.error ?? "", (row) => <span className="whitespace-normal">{row.error ?? ""}</span>),
  dateColumn<UploadRow>("created", "Uploaded", (row) => row.created_at, true),
];

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
    const titleById = new Map((sources.data ?? []).map((source) => [source.id, source.title]));
    const changeByEvent = new Map((changeSets.data ?? []).map((changeSet) => [changeSet.event_id, changeSet.id]));
    return (events.data ?? []).map((event) => ({
      ...event,
      sourceTitle: titleById.get(event.source_id ?? "") ?? "—",
      changeSetId: changeByEvent.get(event.id) ?? null,
    }));
  }, [events.data, sources.data, changeSets.data]);
  return { data, ...readsState([events, sources, changeSets]) };
}
