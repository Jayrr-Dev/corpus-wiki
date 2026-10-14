"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queries";
import { submitEdit } from "@/lib/server-actions/knowledge";

type UnitEditorProps = {
  unitId: string;
  revisionId: string;
  content: string;
  onDone: () => void;
};

// UNIT EDITOR: rewrites one unit's sentence as a revise_claim through Change control
export function UnitEditor({ unitId, revisionId, content, onDone }: UnitEditorProps) {
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const queryClient = useQueryClient();
  const isUnchanged = draft.trim() === "" || draft.trim() === content;

  // Units and revisions have no Realtime feed, so a saved edit refreshes them here
  const refreshUnit = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.table("units") });
    void queryClient.invalidateQueries({ queryKey: queryKeys.table("revisions") });
  };

  // Sends the edit; closes on success, shows the reason on failure
  const save = (event: FormEvent) => {
    event.preventDefault();
    startSaving(async () => {
      const result = await submitEdit({
        type: "revise_claim",
        targetId: unitId,
        expectedRevisionId: revisionId,
        input: { content: draft.trim() },
        passageIds: [],
        speechAct: null,
      });
      if (!result.ok) return setError(result.error);
      refreshUnit();
      onDone();
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
        aria-label="Sentence"
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-panel text-foreground"
      />
      {error ? <p className="text-panel text-failed">{error}</p> : null}
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
