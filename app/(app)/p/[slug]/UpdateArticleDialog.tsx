"use client";

import { type FormEvent, useId, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { updateArticle } from "@/lib/server-actions/pages";

type UpdateScope = "page" | "section" | "tree";

export function UpdateArticleDialog({ id, title, scope, disabled = false }: { id: string; title: string; scope: "page" | "section"; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="outline" disabled={disabled}>Update</Button></DialogTrigger>
    {open ? <DialogContent showCloseButton={!busy}><UpdateArticleForm id={id} title={title} scope={scope} onClose={() => setOpen(false)} onBusy={setBusy} /></DialogContent> : null}
  </Dialog>;
}

export function UpdateArticleForm({ id, title, scope, onClose, onBusy }: { id: string; title: string; scope: UpdateScope; onClose: () => void; onBusy?: (busy: boolean) => void }) {
  const [note, setNote] = useState("");
  const [addNote, setAddNote] = useState(false);
  const [completed, setCompleted] = useState<number | null>(null);
  const update = useServerAction(updateArticle);
  const noteId = useId();
  const toggleId = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending || completed !== null) return;
    onBusy?.(true);
    try {
      const result = await update.run({ scope, id, note: addNote ? note : "" });
      if (result.ok) setCompleted(result.sections);
    } finally { onBusy?.(false); }
  };
  return <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{scope === "tree" ? "Update article & child pages" : `Update ${scope === "page" ? "article" : "section"}`}</DialogTitle>
        <DialogDescription>Refresh “{title}”{scope === "tree" ? " and its child pages" : ""} with the latest saved knowledge and AI skills.</DialogDescription>
      </DialogHeader>
      {completed === null ? <>
        <p className="text-xs text-muted-foreground">Your handwritten text and citations stay intact.</p>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={toggleId} className="text-panel font-medium">Add a note</label>
          <Switch id={toggleId} checked={addNote} onCheckedChange={setAddNote} disabled={update.isPending} aria-controls={addNote ? noteId : undefined} />
        </div>
        {addNote ? <FormRow htmlFor={noteId} label="Note for this update">
          <Textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={update.isPending} placeholder="e.g. Keep the introduction short." rows={3} className="min-h-20 resize-y" />
        </FormRow> : null}
      </> : <p role="status">Updated {completed} {completed === 1 ? "section" : "sections"}. Changes saved.</p>}
      {update.error ? <p role="alert">{update.error}</p> : null}
      {update.isPending ? <p role="status" className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Updating content…</p> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={update.isPending} onClick={onClose}>{completed === null ? "Cancel" : "Done"}</Button>
        {completed === null ? <Button type="submit" disabled={update.isPending}>{update.isPending ? "Updating…" : "Update now"}</Button> : null}
      </DialogFooter>
  </form>;
}

