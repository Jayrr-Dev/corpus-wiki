"use client";

import { useRouter } from "next/navigation";
import { DialogForm } from "@/components/actions/DialogForm";
import { useServerAction } from "@/components/actions/useServerAction";
import { RowMenu } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { removeSource } from "@/lib/server-actions/sources";
import { processUpload, startRerun } from "@/lib/server-actions/upload";

type Source = Tables<"sources">;

// "…" MENU FOR ONE SOURCE: open it, run it through the AI again, or delete it
export function SourceRowMenu({ source }: { source: Source }) {
  return (
    <RowMenu
      label={source.title}
      items={[
        { label: "Open", href: `/sources/${source.id}` },
        { label: "Re-run", body: (close) => <RerunForm source={source} onDone={close} /> },
        { label: "Delete", isDestructive: true, body: (close) => <DeleteForm source={source} onDone={close} /> },
      ]}
    />
  );
}

// RE-RUN: a fresh upload event for the stored file, processed with the model chosen in Settings now.
// When it finishes, the Upload screen's Recent uploads shows the result (and Retry if it failed).
function RerunForm({ source, onDone }: { source: Source; onDone: () => void }) {
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

// DELETE: confirm; knowledge only this file supports is retired (undoable from Changes)
function DeleteForm({ source, onDone }: { source: Source; onDone: () => void }) {
  const remove = useServerAction(removeSource);
  const submit = async () => {
    if ((await remove.run(source.id)).ok) onDone();
  };
  return (
    <DialogForm
      title={`Delete “${source.title}”?`}
      description="The file and its passages are deleted for good. Units that only this file supports are retired; you can undo that from Changes."
      submitLabel="Delete"
      isDestructive
      isPending={remove.isPending}
      error={remove.error}
      onSubmit={submit}
    />
  );
}
