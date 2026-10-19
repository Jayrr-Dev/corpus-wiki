"use client";

import { UploaderName } from "@/app/(app)/_components/ActorName";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { countColumn, dateColumn, linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { Tooltip } from "@/components/standard/tooltip";
import { useSourceRuns } from "@/components/upload/useUnfinishedSources";
import { useMemo, useState } from "react";
import { SourceState } from "./SourceState";

import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { SourceIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/database/types";
import { sourceState } from "@/lib/knowledge/evidence";
import { useShiftEvents, useSources } from "@/lib/queries";
import { type SourceUsage, useSourceUsage } from "@/lib/queries/screens";
import { ExternalReviewHistory } from "./ExternalReviewHistory";
import { ReviewSavedSources } from "./ReviewSavedSources";
import { SourceRowMenu } from "./SourceRowMenu";

type Source = Tables<"sources">;
const SOURCE_TABS = [
  { id: "internal", label: "Internal" },
  { id: "external", label: "External" },
] as const;

// COLUMNS: state, title, internal (uploaded) or external (from the web), the knowledge it produced and the articles that use it,
// the file's own date, who uploaded it and when, and the "…" menu.
// Counts show a dash until they load.
type Uploads = Map<string, Tables<"shift_events">>;

function sourceColumns(usage: Map<string, SourceUsage> | undefined, uploads: Uploads, origin: Source["origin"], { processing, unfinished }: ReturnType<typeof useSourceRuns>) {
  return [
    textColumn<Source>("state", "State", (source) => processing.has(source.id) ? "processing" : unfinished.has(source.id) ? "unfinished" : sourceState(source), (source) => processing.has(source.id) ? (
      <Tooltip content="This source is still being processed. Open it to follow the progress."><span tabIndex={0} className="inline-flex cursor-help"><StatusDot tone="muted" busy label="processing" /></span></Tooltip>
    ) : unfinished.has(source.id) ? (
      <Tooltip content="Processing stopped before it finished. Open the source to resume it."><span tabIndex={0} className="inline-flex cursor-help"><StatusDot tone="needs-you" label="unfinished" /></span></Tooltip>
    ) : (
      <SourceState source={source} />
    )),
    linkColumn<Source>("title", "Title", (source) => source.title, (source) => `/sources/${source.id}`),
    countColumn<Source>("knowledge", "Knowledge", (source) => (usage ? (usage.get(source.id)?.units ?? 0) : null)),
    countColumn<Source>("used", "Used", (source) => (usage ? (usage.get(source.id)?.usedUnits ?? 0) : null)),
    countColumn<Source>("articles", "Articles", (source) => (usage ? (usage.get(source.id)?.articles ?? 0) : null)),
    countColumn<Source>("sections", "Sections", (source) => (usage ? (usage.get(source.id)?.sections ?? 0) : null)),
    countColumn<Source>("lines", "Lines", (source) => (usage ? (usage.get(source.id)?.lines ?? 0) : null)),
    dateColumn<Source>("sourceDate", "Source date", (source) => source.source_date),
    textColumn<Source>("by", origin === "external" ? "Added by" : "Uploaded by", (source) => origin === "external" ? "AI" : uploads.get(source.id)?.person_id ?? "", (source) => origin === "external" ? <span>AI</span> : <UploaderName event={uploads.get(source.id)} />),
    dateColumn<Source>("uploaded", origin === "external" ? "Added" : "Uploaded", (source) => source.created_at, true),
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
  const [origin, setOrigin] = useState<Source["origin"]>("internal");
  const sources = useSources();
  const usage = useSourceUsage();
  const uploads = useFirstUploads();
  const runs = useSourceRuns();
  const columns = useMemo(() => sourceColumns(usage.data, uploads, origin, runs), [usage.data, uploads, origin, runs]);
  const data = useMemo(() => sources.data?.filter((source) => source.origin === origin), [sources.data, origin]);
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Source origin" className="flex gap-1">
        {SOURCE_TABS.map((tab, index) => (
          <Button
            key={tab.id}
            id={`sources-${tab.id}-tab`}
            role="tab"
            aria-selected={origin === tab.id}
            aria-controls="sources-panel"
            tabIndex={origin === tab.id ? 0 : -1}
            size="sm"
            variant={origin === tab.id ? "secondary" : "ghost"}
            onClick={() => setOrigin(tab.id)}
            onKeyDown={(event) => {
              const next = event.key === "Home" ? SOURCE_TABS[0] : event.key === "End" ? SOURCE_TABS[1] : event.key === "ArrowLeft" || event.key === "ArrowRight" ? SOURCE_TABS[1 - index] : undefined;
              if (!next) return;
              event.preventDefault();
              setOrigin(next.id);
              document.getElementById(`sources-${next.id}-tab`)?.focus();
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      {origin === "external" && <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-panel text-muted-foreground">New sources require independent approval against your project context.</p>
        <ExternalReviewHistory />
      </div>}
      {origin === "external" && <ReviewSavedSources />}
      <div id="sources-panel" role="tabpanel" aria-labelledby={`sources-${origin}-tab`} tabIndex={0}>
    <DataTable
      key={origin}
      query={{ ...sources, data }}
      columns={columns}
      getRowId={(source) => source.id}
      filterPlaceholder="Search sources…"
      emptyState={<EmptyState icon={SourceIcon} title={`No ${origin} sources yet`} hint={origin === "internal" ? "Upload a file to add one." : "Sources found by AI will appear here."} />}
    />
      </div>
    </div>
  );
}
