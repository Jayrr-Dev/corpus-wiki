"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import type { ColumnDef } from "@tanstack/react-table";
import { FileText, FileType, Film, Image as ImageIcon, Mail, NotebookPen, type LucideIcon } from "lucide-react";
import { ErrorNote, Section, TextLink } from "@/app/(app)/_components/bits";
import { textColumn } from "@/app/(app)/_components/columns";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { GmailImport } from "@/app/(app)/settings/GmailImport";
import { DataTable } from "@/components/data-table";
import { UploadIcon } from "@/components/icons";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Button } from "@/components/ui/button";
import { Camera, Cursor, easeOut, interaction, lerp, seg, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import { uploadFormatNamesFor } from "@/lib/ingest/formats";
import { defaultFeatureFlags } from "@/lib/flags/registry";
import { cn } from "@/lib/utils";
import { PEOPLE } from "@/lib/video-stage/phoenix/core";
import {
  EARLIER_UPLOADS, GMAIL_ACCOUNT, GMAIL_LABELS, GMAIL_LAST_IMPORT, GMAIL_SELECTED, GMAIL_THREADS, UPLOAD_FILES, uploadEventId, type IntakeUpload,
} from "@/lib/video-stage/phoenix/intake";

// UPLOAD: "You just feed it. PDFs, Word docs, notes, screenshots… even videos. Or connect your Gmail."
// Five file cards fly onto the drop zone in time with the words; the zone lights up on each drop and
// a row lands in Recent uploads, ticking from Processing to Applied. At 5.4 the Gmail card slides in,
// the cursor clicks "Import now" (5.9) and two threads land as rows. 7 seconds.

const DURATION = 7;
const GMAIL_IN = 5.4;
const IMPORT_CLICK = 5.9;
// The import time in the browser's own zone (GmailImport formats it in local time)
const JUST_NOW = new Date(2026, 3, 6, 9, 15).toISOString();

// Frame pixels, measured on the stage at 1920x1080
const DROPZONE = { x: 1083, y: 190 };
const GMAIL_CARD = { left: 1236, top: 92, width: 640 };
const IMPORT_BUTTON = { x: 1806, y: 418 };

const ICONS: Record<string, LucideIcon> = { PDF: FileText, Word: FileType, Notes: NotebookPen, Image: ImageIcon, Video: Film, Gmail: Mail };

// Where each flying card starts (frame pixels): fanned out below and to the right of the zone
const STARTS = [
  { x: 1500, y: 1180, r: 14 },
  { x: 2100, y: 760, r: -10 },
  { x: 1150, y: 1200, r: 8 },
  { x: 2080, y: 380, r: -16 },
  { x: 1700, y: 1220, r: 10 },
];
const FLIGHT = 0.6;

// ONE FILE CARD flying onto the drop zone: glides in, lands at dropAt and sinks into the zone
function FlyingFile({ t, file, index }: { t: number; file: IntakeUpload; index: number }) {
  const start = STARTS[index % STARTS.length]!;
  const fly = easeOut(seg(t, file.dropAt - FLIGHT, file.dropAt));
  const sink = seg(t, file.dropAt, file.dropAt + 0.25);
  if (fly <= 0 || sink >= 1) return null;
  const x = lerp(start.x, DROPZONE.x, fly);
  const y = lerp(start.y, DROPZONE.y, fly);
  const Icon = ICONS[file.label] ?? FileText;
  return (
    <div
      aria-hidden
      className="flex w-80 items-center gap-3 rounded-xl border bg-background p-3 shadow-2xl"
      style={{
        position: "absolute", left: 0, top: 0, zIndex: 900,
        transform: `translate(${x - 160}px, ${y - 36}px) rotate(${lerp(start.r, 0, fly)}deg) scale(${1 - 0.35 * sink})`,
        opacity: 1 - sink,
      }}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-sidebar text-muted-foreground"><Icon size={20} aria-hidden /></span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-panel font-medium">{file.source.title}</span>
        <span className="text-xs text-muted-foreground">{file.label} · {file.size}</span>
      </span>
    </div>
  );
}

// THE DROP ZONE: the same markup as components/upload/UploadDropzone, whose "over" state comes from
// real drag events; here it comes from t (lit while a card lands)
function StageDropzone({ glow }: { glow: number }) {
  const lit = glow > 0.3;
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center", lit ? "border-foreground/40 bg-hover" : "")}
        style={{ boxShadow: glow > 0 ? `0 0 ${40 * glow}px ${6 * glow}px rgb(160 190 255 / ${0.25 * glow})` : undefined }}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-muted" style={{ transform: `scale(${1 + 0.15 * glow})` }}>
          <UploadIcon className="text-muted-foreground" size={18} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{lit ? "Release to add these files" : "Drop files here to upload"}</p>
          <p className="text-xs text-muted-foreground">{uploadFormatNamesFor(defaultFeatureFlags())}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm">Choose files</Button>
          <Button variant="outline" size="sm">Add link</Button>
        </div>
      </div>
      <ErrorNote error={null} />
    </div>
  );
}

// ---------------------------------------------------------------------
// RECENT UPLOADS: the same table, columns and row markup as app/(app)/upload/RecentUploads, fed with
// rows whose status is a function of t (the real one polls each upload's workflow)
// ---------------------------------------------------------------------

type Row = IntakeUpload & { t: number };

const STEPS = ["Reading evidence", "Extracting and saving knowledge · 1 of 2 batches", "Extracting and saving knowledge · 2 of 2 batches", "Writing and reviewing articles"];

// A row's content slides up and fades in as it lands
function landing(row: Row) {
  const p = easeOut(seg(row.t, row.dropAt, row.dropAt + 0.35));
  return { opacity: p, transform: `translateY(${(1 - p) * 10}px)` };
}

// The compact workflow status (components/upload/UploadWorkflowStatus): spinner, label, live stage and bar
function RowStatus({ row }: { row: Row }) {
  if (row.t >= row.appliedAt) return <div className="flex flex-col gap-1.5 whitespace-normal" style={landing(row)}><StatusDot tone="applied" label="Applied" className="font-medium" /></div>;
  const share = seg(row.t, row.dropAt, row.appliedAt);
  const step = STEPS[Math.min(STEPS.length - 1, Math.floor(share * STEPS.length))]!;
  return (
    <div className="flex flex-col gap-1.5 whitespace-normal" style={landing(row)}>
      <span className="inline-flex items-center gap-1.5 font-medium">
        <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-current border-r-transparent" style={{ transform: `rotate(${row.t * 540}deg)` }} />
        <span>Processing</span>
      </span>
      <p className="text-xs text-muted-foreground">{step}</p>
      <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/60" style={{ width: `${Math.max(share * 100, 4)}%` }} /></div>
    </div>
  );
}

const COLUMNS = [
  { ...textColumn<Row>("source", "File", (row) => row.source.title, (row) => (
    <div className="flex flex-col gap-1 whitespace-normal" style={landing(row)}>
      <TextLink href={`/sources/${row.source.id}`} className="font-medium break-words">{row.source.title}</TextLink>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {row.t >= row.appliedAt ? <TextLink href="/changes">View change set</TextLink> : null}
      </div>
    </div>
  )), meta: { cellClassName: "w-2/5 max-w-0 min-w-40 py-3 align-top" } },
  { ...textColumn<Row>("status", "Status", (row) => row.source.title, (row) => <RowStatus row={row} />), meta: { cellClassName: "w-2/5 max-w-0 min-w-40 py-3 align-top" } },
  { ...textColumn<Row>("created", "Uploaded", (row) => row.uploadedAt, (row) => (
    <div className="flex flex-col gap-0.5 whitespace-nowrap" style={landing(row)}>
      <span className="whitespace-nowrap">{row.label === "Gmail" ? "Gmail" : PEOPLE.bill.name}</span>
      <span className="font-mono text-xs text-muted-foreground"><DateTime iso={row.uploadedAt} /></span>
    </div>
  )), meta: { cellClassName: "py-3 align-top" } },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    meta: { cellClassName: "py-3 align-top" },
    cell: ({ row }) => (
      <div className="flex items-start justify-end gap-2" style={landing(row.original)}>
        {row.original.t < row.original.appliedAt ? <Button size="sm" variant="outline">Cancel</Button> : null}
        <RowMenu label={row.original.source.title} items={[{ label: "Open source", href: `/sources/${row.original.source.id}` }]} />
      </div>
    ),
  },
] satisfies ColumnDef<Row, unknown>[];

function StageRecentUploads({ t }: { t: number }) {
  const landed = [...UPLOAD_FILES, ...GMAIL_THREADS].filter((file) => t >= file.dropAt).reverse();
  const data: Row[] = [...landed, ...EARLIER_UPLOADS].map((file) => ({ ...file, t }));
  return (
    <Section title="Recent uploads">
      <div className="space-y-4">
        <div role="tablist" aria-label="Upload source origin" className="flex gap-1 border-b">
          <span role="tab" aria-selected className="border-b-2 border-foreground px-3 py-2 text-panel font-medium text-foreground">Internal<span className="ml-1.5 font-mono text-xs text-faint">{data.length}</span></span>
          <span role="tab" className="border-b-2 border-transparent px-3 py-2 text-panel text-muted-foreground">External<span className="ml-1.5 font-mono text-xs text-faint">0</span></span>
        </div>
        <DataTable query={{ data, isPending: false, error: null }} columns={COLUMNS} getRowId={(row) => uploadEventId(row.key)} pageSize={10} filterPlaceholder="Search uploads…" emptyState={null} />
      </div>
    </Section>
  );
}

// THE GMAIL CARD: Settings' card (app/(app)/settings/page.tsx) around the real GmailImport, sliding in
function GmailCard({ t }: { t: number }) {
  const enter = easeOut(seg(t, GMAIL_IN, GMAIL_IN + 0.45));
  if (enter <= 0) return null;
  const imported = t >= IMPORT_CLICK + 0.25;
  return (
    <section
      aria-label="Gmail"
      className="rounded-2xl border bg-background shadow-2xl"
      style={{ position: "absolute", left: GMAIL_CARD.left, top: GMAIL_CARD.top, width: GMAIL_CARD.width, zIndex: 800, opacity: enter, transform: `translateX(${(1 - enter) * 160}px)` }}
    >
      <header className="flex items-start gap-3 border-b px-6 py-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-sidebar text-muted-foreground"><Mail size={17} aria-hidden="true" /></span>
        <div><h2 className="text-sm font-semibold">Gmail</h2><p className="mt-1 text-panel text-muted-foreground">Import email threads from Gmail as sources.</p></div>
      </header>
      <div className="p-6">
        <style>{importPressCss(t)}</style>
        <div data-stage-gmail>
          <GmailImport
            // remounts after the click, so the last import reads as just now
            key={imported ? "after" : "before"}
            status={{ connected: true, accountEmail: GMAIL_ACCOUNT, labelIds: GMAIL_SELECTED, lastImportAt: imported ? JUST_NOW : GMAIL_LAST_IMPORT }}
            missingEnv={[]}
            outcome={null}
          />
        </div>
      </div>
    </section>
  );
}

// The Import now button sits inside GmailImport (its third block), so its hover and press are applied with a scoped style
function importPressCss(t: number): string {
  const style = interaction(t, { hover: [IMPORT_CLICK - 0.3, IMPORT_CLICK + 0.45], click: IMPORT_CLICK });
  return `[data-stage-gmail] > .grid > div:nth-child(3) button { transform: ${style.transform}; filter: ${style.filter}; }`;
}

function Upload({ t }: { t: number }) {
  // the zone lights up as each card arrives and dims after it sinks in
  const glow = Math.max(0, ...UPLOAD_FILES.map((file) => seg(t, file.dropAt - 0.3, file.dropAt - 0.05) * (1 - seg(t, file.dropAt + 0.15, file.dropAt + 0.45))));
  return (
    <StageProviders seed={(qc) => qc.setQueryData(["gmail-labels"], GMAIL_LABELS)}>
      <Camera t={t} keys={[[0, 1, 1056, 300], [4.8, 1.05, 1056, 300], [5.4, 1.05, 1056, 300], [7, 1.08, 1500, 360]]}>
        <StageShell title="Upload">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3"><StageDropzone glow={glow} /></div>
            <div data-tour="upload-recent"><StageRecentUploads t={t} /></div>
          </div>
        </StageShell>
        {UPLOAD_FILES.map((file, index) => <FlyingFile key={file.key} t={t} file={file} index={index} />)}
        <GmailCard t={t} />
        <Cursor t={t} path={[[0, 1990, 820], [4.9, 1990, 820], [5.75, IMPORT_BUTTON.x, IMPORT_BUTTON.y], [6.05, IMPORT_BUTTON.x, IMPORT_BUTTON.y], [7, IMPORT_BUTTON.x - 20, IMPORT_BUTTON.y + 30]]} clicks={[IMPORT_CLICK]} />
      </Camera>
    </StageProviders>
  );
}

export const upload: Scene = { duration: DURATION, Component: Upload, title: "Upload" };
