"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolvePendingGlossary } from "@/lib/server-actions/glossary";
import type { GlossaryEntry, PendingGlossaryEntry } from "@/lib/glossary/entries";

export function PendingDefinitions({ pending, entries, busy }: { pending: PendingGlossaryEntry[]; entries: GlossaryEntry[]; busy: boolean }) {
  if (!pending.length) return null;
  return (
    <section className="max-w-4xl text-sm" aria-label="Possible duplicates">
      <h2 className="py-4 text-base font-semibold">
        Possible duplicates <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{pending.length}</span>
      </h2>
      <div className="divide-y border-y">{pending.map((item) => <PendingDefinition key={item.entry.meaningId} item={item} entries={entries} busy={busy} />)}</div>
    </section>
  );
}

function PendingDefinition({ item, entries, busy }: { item: PendingGlossaryEntry; entries: GlossaryEntry[]; busy: boolean }) {
  const client = useQueryClient();
  const [target, setTarget] = useState("");
  const [definition, setDefinition] = useState("");
  const [editing, setEditing] = useState(false);
  const candidates = entries.filter((entry) => entry.meaningId && item.candidateIds.includes(entry.meaningId));
  const mutation = useMutation({ mutationFn: async (decision: "keep" | "dismiss" | "merge") => {
    const result = await resolvePendingGlossary({ id: item.entry.meaningId!, decision, ...(decision === "merge" ? { target, definition, expected: candidates.find((candidate) => candidate.meaningId === target)?.definition } : {}) });
    if (!result.ok) throw new Error(result.error);
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["glossary", "dictionary"] }) });
  const disabled = busy || mutation.isPending;
  return (
    <article className="py-6" aria-busy={mutation.isPending}>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">{item.entry.term}</h3>
        <p className="rounded bg-needs-you/10 px-2 py-0.5 text-xs text-needs-you">{item.relationship === "conflicting_evidence" ? "Sources disagree" : "Possible duplicate"}</p>
      </div>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-6">
          <h4 className="pt-0.5 text-xs font-normal text-link">New definition</h4>
          <p className="border-l-2 border-link/40 py-1 pl-3 leading-relaxed">{item.entry.definition}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-6">
          <p className="pt-0.5 text-xs text-muted-foreground">Already saved</p>
          <fieldset disabled={mutation.isPending || editing} className="min-w-0 space-y-3">
            <legend className="sr-only">Choose a definition to combine with</legend>
            {candidates.map((candidate) => <label key={candidate.meaningId} className={`block cursor-pointer rounded-r-md border-l-2 py-1 pl-3 pr-3 transition-colors focus-within:ring-2 focus-within:ring-ring ${target === candidate.meaningId ? "border-link bg-link/10" : "border-border hover:bg-muted/20"}`}>
              <span className="flex items-center gap-2">
                <input className="shrink-0 accent-link" type="radio" name={`candidate-${item.entry.meaningId}`} checked={target === candidate.meaningId} onChange={() => { setTarget(candidate.meaningId!); setDefinition(candidate.definition); mutation.reset(); }} />
                <span className="font-medium">{candidate.term}</span>
              </span>
              <span className="mt-1 block leading-relaxed">{candidate.definition}</span>
            </label>)}
            {!candidates.length && <p className="text-muted-foreground">The matching entry is no longer available.</p>}
          </fieldset>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 pt-2 sm:pl-34">
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1.5">Details & sources</summary>
          <div className="mt-3 max-w-prose space-y-3 leading-relaxed">
            {item.reason && <p>{item.reason}</p>}
            {item.entry.usageNotes?.map((note, i) => <p key={i}>{note.context}: {note.text}</p>)}
            {candidates.flatMap((candidate) => candidate.usageNotes?.map((note, i) => <p key={`${candidate.meaningId}-${i}`}>{candidate.term} — {note.context}: {note.text}</p>) ?? [])}
            {[...new Map(item.entry.citations.map((cite) => [cite.sourceId, cite])).values()].map((cite) => <Link key={cite.sourceId} className="block break-words underline underline-offset-4" href={`/sources/${cite.sourceId}`}>{cite.sourceTitle}</Link>)}
          </div>
        </details>
        {!editing && <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => mutation.mutate("keep")}>Keep both</Button>
          <Button size="sm" variant="accent" disabled={mutation.isPending || (!target && candidates.length !== 1)} onClick={() => {
            if (!target && candidates.length === 1) {
              setTarget(candidates[0]!.meaningId!);
              setDefinition(candidates[0]!.definition);
            }
            mutation.reset();
            setEditing(true);
          }}>Combine…</Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => mutation.mutate("dismiss")}>Discard new</Button>
          {mutation.isPending && <span role="status" className="text-xs text-muted-foreground">Saving…</span>}
        </div>
        {busy ? <p role="status" className="max-w-sm text-xs text-needs-you">Glossary updating. You can compare now; saving unlocks when it finishes.</p> : !target && candidates.length > 1 ? <p className="text-xs text-muted-foreground">Select a saved definition to combine.</p> : null}
        </div>}
        </div>
        {editing && <div className="space-y-3 sm:ml-34">
          <label className="block space-y-2">
            <span className="font-medium">Final definition</span>
            <span className="block text-xs text-muted-foreground">Keep the useful details from both. Saving will replace the selected definition.</span>
            <Textarea autoFocus disabled={mutation.isPending} value={definition} onChange={(event) => setDefinition(event.target.value)} maxLength={1000} minLength={10} rows={4} />
          </label>
          {busy && <p role="status" className="text-xs text-needs-you">Glossary updating. You can edit now and save when it finishes.</p>}
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => { setEditing(false); mutation.reset(); }}>Cancel</Button>
            <Button size="sm" variant="accent" disabled={disabled || definition.trim().length < 10} onClick={() => mutation.mutate("merge")}>{mutation.isPending ? "Saving…" : "Save combined definition"}</Button>
          </div>
        </div>}
        {mutation.error && <p role="alert" className="text-destructive sm:ml-34">{mutation.error.message}</p>}
      </div>
    </article>
  );
}






