"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useLayoutEffect, useRef, useState, useTransition } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { withProgress } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { queryKeys, type TableName } from "@/lib/queries";
import type { ActionResult } from "@/lib/server-actions/result";
import { cn } from "@/lib/utils";

type TextEditorProps = {
  content: string;
  label: string;
  // Sends the new text through a server action (Change control)
  onSave: (text: string) => Promise<ActionResult>;
  onDone: () => void;
  // Tables without a Realtime feed that the save changes (refetched after it)
  refreshTables?: TableName[];
  // Edits in place on the page: the text keeps the paragraph's look (no box), Enter saves
  inline?: boolean;
};

// A quick save shows no toast; a save that rewrites sections shows one after this long
const EDIT_TOAST_DELAY_MS = 800;

// TEXT EDITOR: rewrites one line or claim; closes on success, shows the reason on failure
export function TextEditor({ content, label, onSave, onDone, refreshTables = [], inline = false }: TextEditorProps) {
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const queryClient = useQueryClient();
  const isUnchanged = draft.trim() === "" || draft.trim() === content;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grows the box to fit the whole text so nothing is hidden behind a scrollbar,
  // again whenever its width changes (the text rewraps)
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const fit = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight + (inline ? 0 : 2)}px`;
    };
    fit();
    let width = textarea.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.offsetWidth === width) return;
      width = textarea.offsetWidth;
      fit();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [draft, inline]);

  // Opens with the caret at the end of the text, where an edit usually starts
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  // Saves, then refreshes the tables the edit touched
  const save = (event: FormEvent) => {
    event.preventDefault();
    startSaving(async () => {
      const result = await withProgress("Saving your edit", "Rewriting the affected sections…", () => onSave(draft.trim()), (saved) => saved.ok, { delayMs: EDIT_TOAST_DELAY_MS });
      if (!result.ok) return setError(result.error);
      for (const table of refreshTables) void queryClient.invalidateQueries({ queryKey: queryKeys.table(table) });
      onDone();
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={inline ? 1 : 3}
        aria-label={label}
        autoFocus
        readOnly={isSaving}
        // Escape cancels; Enter saves in place (a line is one paragraph), Ctrl/Cmd+Enter saves in the panel
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isSaving) onDone();
          if (event.key === "Enter" && (inline ? !event.shiftKey : event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (!isUnchanged && !isSaving) event.currentTarget.form?.requestSubmit();
          }
        }}
        className={cn(
          "w-full text-foreground",
          inline
            ? "block resize-none overflow-hidden border-0 bg-transparent p-0 text-body leading-7 outline-none"
            : "max-h-[60vh] min-h-24 resize-y rounded-md border border-input bg-background px-2.5 py-1.5 text-panel",
          isSaving && "opacity-60",
        )}
      />
      <ErrorNote error={error} />
      <div className={cn("flex items-center gap-2", inline && "gap-1.5")}>
        <Button type="submit" size={inline ? "xs" : "sm"} disabled={isSaving || isUnchanged}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size={inline ? "xs" : "sm"} variant="ghost" onClick={onDone} disabled={isSaving}>
          Cancel
        </Button>
        {inline ? <span className="text-xs text-faint">Enter to save · Esc to cancel</span> : null}
      </div>
    </form>
  );
}
