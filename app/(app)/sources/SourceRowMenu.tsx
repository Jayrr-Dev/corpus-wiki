"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Note } from "@/app/(app)/_components/bits";
import { toDateInputValue } from "@/app/(app)/_lib/format";
import { DialogForm } from "@/components/actions/DialogForm";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/database/types";
import { UPLOAD_ACCEPT } from "@/lib/ingest/formats";
import { sourceState } from "@/lib/knowledge/evidence";
import { queryKeys } from "@/lib/queries";
import {
  archiveSourceAction,
  purgeSourceAction,
  removeSource,
  replaceSource,
  restoreSourceAction,
  sourceImpact,
} from "@/lib/server-actions/sources";
import { processUpload, startRerun } from "@/lib/server-actions/upload";

type Source = Tables<"sources">;

// =====================================================================
// "…" MENU FOR ONE SOURCE (Sources, Upload's Recent uploads, Source detail).
// Every way to take a file out of play says what happens to the knowledge
// that cites it:
//   Replace  upload a newer version; the old one is archived (its knowledge stale until re-sourced)
//   Archive  keep the file; knowledge citing it is stale       (Restore undoes it)
//   Delete   drop the file; knowledge citing it is lost (kept, marked)
//   Purge    drop the file and the knowledge only it supports (undo the knowledge from Changes)
// =====================================================================

export function SourceRowMenu({ source }: { source: Source }) {
  const isArchived = sourceState(source) !== "active";
  return (
    <RowMenu
      label={source.title}
      items={[
        { label: "Open", href: `/sources/${source.id}` },
        { label: "Re-run", separatorBefore: true, isDisabled: isArchived, body: (close) => <RerunForm source={source} onDone={close} /> },
        { label: "Replace", isAccent: true, body: (close) => <ReplaceForm source={source} onDone={close} /> },
        isArchived
          ? { label: "Restore", separatorBefore: true, body: (close) => <RestoreForm source={source} onDone={close} /> }
          : { label: "Archive", separatorBefore: true, body: (close) => <ArchiveForm source={source} onDone={close} /> },
        { label: "Delete", separatorBefore: true, isDestructive: true, body: (close) => <DeleteForm source={source} onDone={close} /> },
        { label: "Purge", isDestructive: true, body: (close) => <PurgeForm source={source} onDone={close} /> },
      ]}
    />
  );
}

type FormProps = { source: Source; onDone: () => void };

// RE-RUN: a fresh upload event for the stored file, processed with the model chosen in Settings now.
// When it finishes, the Upload screen's Recent uploads shows the result (and Retry if it failed).
function RerunForm({ source, onDone }: FormProps) {
  const router = useRouter();
  const start = useServerAction(startRerun);
  const process = useServerAction(processUpload);
  const submit = async () => {
    const started = await start.run(source.id);
    if (!started.ok || started.kind !== "started") return;
    await process.run(started.eventId);
    onDone();
    router.push("/upload");
  };
  return (
    <DialogForm
      title={`Re-run “${source.title}”?`}
      description="The AI reads the stored file again with the model chosen in Settings. What it finds goes through the usual checks."
      submitLabel="Re-run"
      isPending={start.isPending || process.isPending}
      error={start.error ?? process.error}
      onSubmit={submit}
    />
  );
}

// REPLACE: pick the newer file and its date; it is uploaded and reconciled like any file,
// so knowledge it confirms moves onto it and anything it no longer says stays stale
function ReplaceForm({ source, onDone }: FormProps) {
  const router = useRouter();
  const fileId = useId();
  const dateId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [sourceDate, setSourceDate] = useState(() => toDateInputValue(Date.now()));
  const replace = useServerAction(replaceSource);
  const process = useServerAction(processUpload);
  const submit = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.set("sourceId", source.id);
    formData.set("file", file);
    formData.set("sourceDate", sourceDate);
    const started = await replace.run(formData);
    if (!started.ok) return;
    await process.run(started.eventId);
    onDone();
    router.push("/upload");
  };
  return (
    <DialogForm
      title={`Replace “${source.title}”`}
      description="The new file is read like any upload. The old one is archived and kept as the previous version; knowledge only it still supports shows as stale."
      submitLabel="Upload and replace"
      isPending={replace.isPending || process.isPending}
      isDisabled={!file || !sourceDate}
      error={replace.error ?? process.error}
      onSubmit={submit}
    >
      <FormRow htmlFor={fileId} label="New version">
        <Input id={fileId} type="file" accept={UPLOAD_ACCEPT} onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          setFile(picked);
          if (picked) setSourceDate(toDateInputValue(picked.lastModified));
        }} />
      </FormRow>
      <FormRow htmlFor={dateId} label="The new file's date">
        <Input id={dateId} type="date" value={sourceDate} onChange={(event) => setSourceDate(event.target.value)} className="w-40" />
      </FormRow>
    </DialogForm>
  );
}

// ARCHIVE: the file stays; everything citing it is marked stale
function ArchiveForm({ source, onDone }: FormProps) {
  const archive = useServerAction(archiveSourceAction);
  return (
    <DialogForm
      title={`Archive “${source.title}”?`}
      description="The file is kept but no longer counts as current evidence. Knowledge that cites it is marked stale. Restore it any time."
      submitLabel="Archive"
      isPending={archive.isPending}
      error={archive.error}
      onSubmit={async () => {
        if ((await archive.run(source.id)).ok) onDone();
      }}
    >
      <ImpactNote sourceId={source.id} describe={(impact) => `${count(impact.linkedUnits, "unit")} will be marked stale.`} />
    </DialogForm>
  );
}

// RESTORE: an archived or replaced file counts as evidence again
function RestoreForm({ source, onDone }: FormProps) {
  const restore = useServerAction(restoreSourceAction);
  return (
    <DialogForm
      title={`Restore “${source.title}”?`}
      description="The file counts as current evidence again, so knowledge that cites it is no longer stale."
      submitLabel="Restore"
      isPending={restore.isPending}
      error={restore.error}
      onSubmit={async () => {
        if ((await restore.run(source.id)).ok) onDone();
      }}
    />
  );
}

// DELETE: the file goes; knowledge is kept but marked lost
function DeleteForm({ source, onDone }: FormProps) {
  const remove = useServerAction(removeSource);
  const leave = useLeaveDeletedSource(source.id, onDone);
  return (
    <DialogForm
      title={`Delete “${source.title}”?`}
      description="The file and its passages are deleted for good. Knowledge that cites it is kept but marked lost, because its source is missing."
      submitLabel="Delete"
      isDestructive
      isPending={remove.isPending}
      error={remove.error}
      onSubmit={async () => {
        if ((await remove.run(source.id)).ok) leave();
      }}
    >
      <ImpactNote sourceId={source.id} describe={(impact) => `${count(impact.linkedUnits, "unit")} will be marked lost.`} />
    </DialogForm>
  );
}

// PURGE: the file goes, and so does the knowledge only it supports
function PurgeForm({ source, onDone }: FormProps) {
  const purge = useServerAction(purgeSourceAction);
  const leave = useLeaveDeletedSource(source.id, onDone);
  return (
    <DialogForm
      title={`Purge “${source.title}” and its knowledge?`}
      description="The file and its passages are deleted for good. Knowledge only this file supports is retired, knowledge other files also support drops this citation, and articles are rebuilt. The knowledge changes can be undone from Changes; the file cannot."
      submitLabel="Purge"
      isDestructive
      isPending={purge.isPending}
      error={purge.error}
      onSubmit={async () => {
        if ((await purge.run(source.id)).ok) leave();
      }}
    >
      <ImpactNote
        sourceId={source.id}
        describe={(impact) => `${count(impact.onlyFromUnits, "unit")} will be retired and ${count(impact.sharedUnits, "unit")} updated.`}
      />
    </DialogForm>
  );
}

// After a delete or purge: close the dialog, and leave the source's own page (it no longer exists)
function useLeaveDeletedSource(sourceId: string, onDone: () => void): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return () => {
    onDone();
    if (pathname === `/sources/${sourceId}`) router.push("/sources");
  };
}

type Impact = { linkedUnits: number; onlyFromUnits: number; sharedUnits: number };

// IMPACT LINE: how much knowledge the action touches, read when the dialog opens
function ImpactNote({ sourceId, describe }: { sourceId: string; describe: (impact: Impact) => string }) {
  const impact = useQuery({
    queryKey: [...queryKeys.table("sources"), "impact", sourceId],
    queryFn: async () => {
      const result = await sourceImpact(sourceId);
      if (!result.ok) throw new Error(result.error);
      return result;
    },
  });
  if (impact.error) return <Note>Could not count the knowledge that cites this file.</Note>;
  if (!impact.data) return <Note>Counting the knowledge that cites this file…</Note>;
  return <p className="text-panel">{describe(impact.data)}</p>;
}

// "1 unit" / "3 units"
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
