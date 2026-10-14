"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState, useTransition } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { Button } from "@/components/ui/button";
import { queryKeys, type TableName } from "@/lib/queries";
import type { ActionResult } from "@/lib/server-actions/result";

type TextEditorProps = {
  content: string;
  label: string;
  // Sends the new text through a server action (Change control)
  onSave: (text: string) => Promise<ActionResult>;
  onDone: () => void;
  // Tables without a Realtime feed that the save changes (refetched after it)
  refreshTables?: TableName[];
};

// TEXT EDITOR: rewrites one line or claim; closes on success, shows the reason on failure
export function TextEditor({ content, label, onSave, onDone, refreshTables = [] }: TextEditorProps) {
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const queryClient = useQueryClient();
  const isUnchanged = draft.trim() === "" || draft.trim() === content;

  // Saves, then refreshes the tables the edit touched
  const save = (event: FormEvent) => {
    event.preventDefault();
    startSaving(async () => {
      const result = await onSave(draft.trim());
      if (!result.ok) return setError(result.error);
      for (const table of refreshTables) void queryClient.invalidateQueries({ queryKey: queryKeys.table(table) });
      onDone();
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        aria-label={label}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-panel text-foreground"
      />
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSaving || isUnchanged}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
