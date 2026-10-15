"use client";

import { type FormEvent, useId, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { updateArticle } from "@/lib/server-actions/pages";

export function UpdateArticleDialog({ id, title, scope, disabled = false }: { id: string; title: string; scope: "page" | "section"; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="outline" disabled={disabled}>Update</Button></DialogTrigger>
    {open ? <DialogContent showCloseButton={!busy}><UpdateArticleForm id={id} title={title} scope={scope} onClose={() => setOpen(false)} onBusy={setBusy} /></DialogContent> : null}
  </Dialog>;
}

function UpdateArticleForm({ id, title, scope, onClose, onBusy }: { id: string; title: string; scope: "page" | "section"; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const [note, setNote] = useState("");
  const [completed, setCompleted] = useState<number | null>(null);
  const update = useServerAction(updateArticle);
  const noteId = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending || completed !== null) return;
    onBusy(true);
    try {
      const result = await update.run({ scope, id, note });
      if (result.ok) setCompleted(result.sections);
    } finally { onBusy(false); }
  };
  return <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Update {scope === "page" ? "article" : "section"}</DialogTitle>
        <DialogDescription>Refresh “{title}” using the latest saved knowledge, sources, and assigned writing skill.</DialogDescription>
      </DialogHeader>
      {completed === null ? <>
        <p className="text-panel text-muted-foreground">The AI checks the {scope === "page" ? "article for relevant new knowledge and adds topic sections when needed" : "section’s current knowledge selection for changes"}, then refreshes generated text even if only the skill changed. Your handwritten text and citations are preserved.</p>
        <FormRow htmlFor={noteId} label="Note for the AI (optional)">
          <Textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={update.isPending} placeholder="For example: explain the two violation classes more clearly and keep the introduction short." className="h-28 resize-y" />
        </FormRow>
        <p className="text-panel text-muted-foreground">Your note applies to this update only. Uses data already in your knowledge base. Manage reusable instructions in <Link href="/skills" className="text-link hover:underline">Skills</Link>.</p>
      </> : <p role="status">Updated {completed} {completed === 1 ? "section" : "sections"} using the current knowledge and skills. Changes are saved.</p>}
      {update.error ? <p role="alert">{update.error}</p> : null}
      {update.isPending ? <p role="status" className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Checking knowledge and updating…</p> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={update.isPending} onClick={onClose}>{completed === null ? "Cancel" : "Done"}</Button>
        {completed === null ? <Button type="submit" disabled={update.isPending}>{update.isPending ? "Updating…" : "Update now"}</Button> : null}
      </DialogFooter>
  </form>;
}
