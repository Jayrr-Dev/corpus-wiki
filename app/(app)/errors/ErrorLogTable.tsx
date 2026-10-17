"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { dateColumn, statusColumn, textColumn } from "@/app/(app)/_components/columns";
import { Facts } from "@/app/(app)/_components/bits";
import { DateTime } from "@/app/(app)/_components/DateTime";
import type { Tone } from "@/app/(app)/_lib/tone";
import { DialogForm } from "@/components/actions/DialogForm";
import { useServerAction } from "@/components/actions/useServerAction";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/EmptyState";
import { ErrorLogIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Tables } from "@/lib/database/types";
import { componentFromStack } from "@/lib/errors/componentFromStack";
import { useErrorLog } from "@/lib/queries";
import { clearErrorLog } from "@/lib/server-actions/errors";

// =====================================================================
// ERROR LOG TABLE: every logged error, newest first, filterable by where
// it came from and searchable. A row opens its full message and stack.
// Refreshes on its own so new errors show up while the page is open.
// =====================================================================

type ErrorRow = Tables<"error_log">;
type Level = "error" | "warning";

const LEVEL_TONE: Record<Level, Tone> = { error: "failed", warning: "needs-you" };

// WHERE AN ERROR CAME FROM, in words
const SOURCE_LABEL: Record<string, string> = {
  server: "Server",
  action: "Action",
  console: "Background",
  client: "Browser",
  ai: "AI call",
};
const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? source;

// How often the log reloads while open
const REFRESH_MS = 10_000;

// The component an error happened in (rows logged before it was stored are read from their stack)
const componentOf = (row: ErrorRow) => row.component ?? componentFromStack(row.stack);

const COLUMNS: ColumnDef<ErrorRow, unknown>[] = [
  dateColumn<ErrorRow>("created", "When", (row) => row.created_at, true),
  statusColumn<ErrorRow, Level>("Level", (row) => (row.level === "warning" ? "warning" : "error"), LEVEL_TONE),
  textColumn<ErrorRow>("source", "Source", (row) => sourceLabel(row.source)),
  textColumn<ErrorRow>("page", "Page", (row) => row.path ?? "", (row) => row.path ? <span className="block max-w-56 truncate font-mono text-muted-foreground">{row.path}</span> : <span className="text-faint">—</span>),
  textColumn<ErrorRow>("component", "Component", (row) => componentOf(row) ?? "", (row) => {
    const component = componentOf(row);
    return component ? <span className="font-mono">{component}</span> : <span className="text-faint">—</span>;
  }),
  { ...textColumn<ErrorRow>("message", "Message", (row) => `${row.message} ${row.location ?? ""}`, (row) => (
    <span className="block truncate">
      {row.message}
      {row.location ? <span className="text-faint"> · {row.location}</span> : null}
    </span>
  )), meta: { cellClassName: "w-full max-w-0 min-w-48" } },
];

export function ErrorLogTable() {
  const log = useErrorLog();
  const refetch = log.refetch;
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => void refetch(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refetch]);

  const rows = useMemo(() => (log.data ?? []).filter((row) => (!source || row.source === source) && (!level || row.level === level)), [log.data, source, level]);
  const selected = log.data?.find((row) => row.id === selectedId);
  const hasRows = (log.data?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Error source" value={source} onChange={(event) => setSource(event.target.value)} className="w-fit">
          <NativeSelectOption value="">All sources</NativeSelectOption>
          {Object.entries(SOURCE_LABEL).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect aria-label="Error level" value={level} onChange={(event) => setLevel(event.target.value)} className="w-fit">
          <NativeSelectOption value="">Errors and warnings</NativeSelectOption>
          <NativeSelectOption value="error">Errors only</NativeSelectOption>
          <NativeSelectOption value="warning">Warnings only</NativeSelectOption>
        </NativeSelect>
        <div className="ml-auto">{hasRows ? <ClearLogButton /> : null}</div>
      </div>
      <DataTable query={{ data: rows, isPending: log.isPending, error: log.error }} columns={COLUMNS} getRowId={(row) => row.id}
        pageSize={25} filterPlaceholder="Search errors…" selectedRowId={selectedId ?? undefined} onRowClick={(row) => setSelectedId(row.id)}
        emptyState={<EmptyState icon={ErrorLogIcon} title={hasRows ? "No errors match" : "No errors logged"} hint="Errors from pages, actions, uploads, AI calls and the browser appear here." />} />
      <ErrorDetail row={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

// ONE ERROR: everything stored about it
function ErrorDetail({ row, onClose }: { row: ErrorRow | undefined; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        {row ? <>
          <DialogHeader>
            <DialogTitle>{sourceLabel(row.source)} {row.level === "warning" ? "warning" : "error"}</DialogTitle>
            <DialogDescription>Everything recorded about this error.</DialogDescription>
          </DialogHeader>
          <Facts items={[
            ["When", <DateTime key="when" iso={row.created_at} />],
            ...facts([["Where", row.location], ["Page", row.path], ["Component", componentOf(row)], ["Digest", row.digest]]),
          ]} />
          <pre className="rounded-lg bg-muted/50 p-3 text-panel whitespace-pre-wrap break-words">{row.message}</pre>
          {row.stack ? <pre className="max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs whitespace-pre">{row.stack}</pre> : null}
        </> : null}
      </DialogContent>
    </Dialog>
  );
}

// The facts that were recorded, the page, component and digest in mono
function facts(items: [string, string | null][]): [string, ReactNode][] {
  return items.filter((item): item is [string, string] => !!item[1])
    .map(([label, value]) => [label, label === "Where" ? value : <span key={label} className="font-mono break-all">{value}</span>]);
}

// CLEAR LOG: asks first, then removes every entry
function ClearLogButton() {
  const [open, setOpen] = useState(false);
  const clear = useServerAction(clearErrorLog, { progress: false, refreshTables: ["error_log"] });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Clear log</Button></DialogTrigger>
      <DialogContent>
        <DialogForm title="Clear the error log?" description="Every entry is removed. New errors keep being logged as they happen."
          submitLabel="Clear log" isDestructive isPending={clear.isPending} error={clear.error}
          onSubmit={async () => { if ((await clear.run()).ok) setOpen(false); }} />
      </DialogContent>
    </Dialog>
  );
}
