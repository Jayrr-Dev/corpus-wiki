"use client";

import { useMemo } from "react";
import { UploaderName } from "@/app/(app)/_components/ActorName";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { countColumn, dateColumn, linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { SOURCE_STATE_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { SourceIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { sourceState } from "@/lib/knowledge/evidence";
import { useShiftEvents, useSources } from "@/lib/queries";
import { type SourceUsage, useSourceUsage } from "@/lib/queries/screens";
import { SourceRowMenu } from "./SourceRowMenu";

type Source = Tables<"sources">;

// COLUMNS: state, title, internal (uploaded) or external (from the web), the knowledge it produced and the articles that use it,
// the file's own date, who uploaded it and when, and the "…" menu.
// Counts show a dash until they load.
type Uploads = Map<string, Tables<"shift_events">>;

function sourceColumns(usage: Map<string, SourceUsage> | undefined, uploads: Uploads) {
  return [
    textColumn<Source>("state", "State", (source) => sourceState(source), (source) => (
      <StatusDot tone={SOURCE_STATE_TONE[sourceState(source)]} label={sourceState(source)} />
    )),
    linkColumn<Source>("title", "Title", (source) => source.title, (source) => `/sources/${source.id}`),
    textColumn<Source>("origin", "Origin", (source) => (source.origin === "external" ? "External" : "Internal")),
    countColumn<Source>("knowledge", "Knowledge", (source) => (usage ? (usage.get(source.id)?.units ?? 0) : null)),
    countColumn<Source>("articles", "Articles", (source) => (usage ? (usage.get(source.id)?.articles ?? 0) : null)),
    countColumn<Source>("lines", "Lines", (source) => (usage ? (usage.get(source.id)?.lines ?? 0) : null)),
    dateColumn<Source>("sourceDate", "Source date", (source) => source.source_date),
    textColumn<Source>("by", "Uploaded by", (source) => uploads.get(source.id)?.person_id ?? "", (source) => <UploaderName event={uploads.get(source.id)} />),
    dateColumn<Source>("uploaded", "Uploaded", (source) => source.created_at, true),
    menuColumn<Source>((source) => <SourceRowMenu source={source} />),
  ];
}

// Each source's first upload event (reruns come later), by source id
function useFirstUploads(): Uploads {
  const events = useShiftEvents({ filters: { cause: "upload" }, ascending: true }).data;
  return useMemo(() => {
    const first: Uploads = new Map();
    for (const event of events ?? []) if (event.source_id && !first.has(event.source_id)) first.set(event.source_id, event);
    return first;
  }, [events]);
}

// SOURCES TABLE
export function SourcesTable() {
  const usage = useSourceUsage();
  const uploads = useFirstUploads();
  const columns = useMemo(() => sourceColumns(usage.data, uploads), [usage.data, uploads]);
  return (
    <DataTable
      query={useSources()}
      columns={columns}
      getRowId={(source) => source.id}
      filterPlaceholder="Search sources…"
      emptyState={<EmptyState icon={SourceIcon} title="No sources yet" hint="Upload a file to add one." />}
    />
  );
}
