"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { startProgress } from "@/components/toast";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { forceCreateOptions, forceCreateSection } from "@/lib/server-actions/pages";

type Options = { webAllowed: boolean; webReady: boolean };
type Outcome = { internal: number; external: number; sources: { title: string; url: string }[] };

// FORCE CREATE: builds out a section from every saved claim that fits its heading and,
// when Settings allows it, from web pages saved as external sources
export function ForceCreateForm({ sectionId, title, onClose }: { sectionId: string; title: string; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<Options | null>(null);
  const [useWeb, setUseWeb] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // The old section is retired when this succeeds, which can unmount this dialog with its
  // menu, so the outcome is also told in the progress toast (and an error in its own toast)
  const create = useServerAction(forceCreateSection, { progress: false });
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const noteId = useId();
  const webId = useId();

  useEffect(() => {
    let live = true;
    void forceCreateOptions().then((result) => {
      if (!live || !result.ok) return;
      setOptions({ webAllowed: result.webAllowed, webReady: result.webReady });
      setUseWeb(result.webAllowed && result.webReady);
    });
    return () => { live = false; };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending || outcome) return;
    const progress = startProgress(`Force creating “${title}”`, useWeb ? "Searching the web and gathering knowledge…" : "Gathering saved knowledge…");
    const result = await create.run({ sectionId, note, useWeb });
    if (result.ok) {
      const next = { internal: result.internal, external: result.external, sources: result.sources };
      progress.done(outcomeSummary(next));
      setOutcome(next);
    } else {
      progress.fail();
      if (!mounted.current) toast.error(result.error);
    }
  };

  return <form onSubmit={submit} className="flex flex-col gap-4">
    <DialogHeader>
      <DialogTitle>Force create section</DialogTitle>
      <DialogDescription>Build out “{title}” from the knowledge that fits its heading{useWeb ? ", searching the web for more" : ""}.</DialogDescription>
    </DialogHeader>
    {outcome ? <ForceCreateOutcome outcome={outcome} /> : <>
      <FormRow htmlFor={noteId} label="Instructions (optional)">
        <Textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={create.isPending} placeholder="e.g. Cover reporting steps and who to contact." rows={3} className="min-h-20 resize-y" />
      </FormRow>
      <WebSearchChoice id={webId} options={options} checked={useWeb} disabled={create.isPending} onChange={setUseWeb} />
      <p className="text-xs text-muted-foreground">The section is replaced in place. You can undo this on the Changes screen.</p>
    </>}
    {create.error ? <p role="alert">{create.error}</p> : null}
    {create.isPending ? <p role="status" className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{useWeb ? "Searching and building… this can take a minute." : "Building…"}</p> : null}
    <DialogFooter>
      <Button type="button" variant="ghost" disabled={create.isPending} onClick={onClose}>{outcome ? "Done" : "Cancel"}</Button>
      {outcome ? null : <Button type="submit" disabled={create.isPending || !options}>{create.isPending ? "Creating…" : "Force create"}</Button>}
    </DialogFooter>
  </form>;
}

// SEARCH THE WEB: a switch when Settings allows it, otherwise a pointer to Settings
function WebSearchChoice({ id, options, checked, disabled, onChange }: { id: string; options: Options | null; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  if (!options) return <p className="text-xs text-muted-foreground">Checking knowledge settings…</p>;
  if (!options.webAllowed) return <p className="text-xs text-muted-foreground">Uses your own sources only. To search the web too, turn on external knowledge in <Link href="/settings" className="underline">Settings</Link>.</p>;
  return <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-panel font-medium">Search the web</label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled || !options.webReady} />
    </div>
    <p className="text-xs text-muted-foreground">{options.webReady ? "Pages it uses are saved as external sources. Their knowledge only adds to yours." : "Searches Wikipedia. Pages it uses are saved as external sources."}</p>
  </div>;
}

function outcomeSummary(outcome: Outcome): string {
  if (!outcome.internal && !outcome.external) return "Rebuilt from the claims it already had.";
  return `Added ${outcome.internal} ${outcome.internal === 1 ? "claim" : "claims"} from your sources and ${outcome.external} from the web.`;
}

function ForceCreateOutcome({ outcome }: { outcome: Outcome }) {
  return <div role="status" className="flex flex-col gap-2">
    <p>{outcomeSummary(outcome)}</p>
    {outcome.sources.length ? <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">External sources read:</p>
      <ul className="flex flex-col gap-1 text-panel">
        {outcome.sources.map((source) => <li key={source.url} className="truncate"><a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title}</a></li>)}
      </ul>
    </div> : null}
  </div>;
}
