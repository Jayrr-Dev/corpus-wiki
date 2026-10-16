"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { BookOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/standard/loader";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/standard/tooltip";
import { useUnits } from "@/lib/queries";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { glossaryClient, type GlossaryState } from "@/lib/glossary/storage";
import { RightPanelSlot } from "@/components/shell";
import { glossaryAnchor, glossaryEntryKey, glossaryLetter, glossarySentenceCase, type GlossaryEntry } from "@/lib/glossary/entries";
import { changeGlossaryDefinition, regenerateGlossaryDefinition, requestGlossaryGeneration, searchGlossaryMeaning } from "@/lib/server-actions/glossary";
import { cn } from "@/lib/utils";
import { DefinitionPanel, type DefinitionPreview } from "./DefinitionPanel";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat("#");
const CATEGORIES = ["All terms", "general term", "acronym", "technical term", "jargon", "uncommon word"] as const;
const CATEGORY_LABELS = ["All terms", "General terms", "Acronyms", "Technical terms", "Jargon", "Uncommon words"];
const CATEGORY_COLORS: Record<string, string> = {
  "general term": "bg-muted text-muted-foreground",
  acronym: "bg-blue-950 text-blue-100",
  "technical term": "bg-emerald-950 text-emerald-100",
  jargon: "bg-amber-950 text-amber-100",
  "uncommon word": "bg-violet-950 text-violet-100",
};
const QUERY_KEY = ["glossary", "dictionary"];
const EMPTY_ENTRIES: GlossaryEntry[] = [];
type DictionarySource = { sourceId: string; sourceTitle: string; number: number };
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en");

export function GlossaryScreen() {
  useRealtimeInvalidation("units");
  const units = useUnits({ filters: { retired_at: null } });
  const client = useQueryClient();
  const checked = useRef("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All terms");
  const [letter, setLetter] = useState<string | null>(null);
  // The definition whose details fill the right panel, and an older version shown in its place
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<DefinitionPreview | null>(null);
  const meaning = useMutation({
    mutationFn: async (question: string) => {
      const result = await searchGlossaryMeaning(question);
      if (!result.ok) throw new Error(result.error);
      return result;
    },
  });
  const generation = useMutation({
    mutationFn: async (force: boolean) => {
      const result = await requestGlossaryGeneration(force);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: QUERY_KEY }); },
  });
  const { mutate: generate } = generation;
  const signature = useMemo(() => units.data?.map((unit) => `${unit.id}:${unit.current_revision_id}`).sort().join("|"), [units.data]);
  useEffect(() => {
    if (signature === undefined || checked.current === `checked:${signature}`) return;
    checked.current = `checked:${signature}`;
    generate(false);
  }, [signature, generate]);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await glossaryClient(getBrowserSupabase()).from("glossary_state")
        .select("entries, generated_at, status, completed_batches, total_batches, error, lease_until").eq("id", true).single();
      if (error) throw new Error(error.message);
      const state = data as unknown as Pick<GlossaryState, "entries" | "generated_at" | "status" | "completed_batches" | "total_batches" | "error" | "lease_until">;
      return { ...state, active: state.status === "generating" && !!state.lease_until && Date.parse(state.lease_until) > Date.now() };
    },
    refetchInterval: (current) => current.state.data?.status === "generating" || current.state.data?.status === "idle" ? 2000 : 15000,
    refetchOnWindowFocus: true,
  });
  const state = query.data;
  useEffect(() => {
    if (!state?.generated_at || !window.location.hash.startsWith("#term-")) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [state?.generated_at]);
  const entries = state?.entries ?? EMPTY_ENTRIES;
  const busy = generation.isPending || state?.active;
  const semanticEntries = meaning.data?.query === search.trim() ? meaning.data.entries : null;
  const available = useMemo(() => (semanticEntries ?? entries).filter((entry) => {
    const needle = normalize(search.trim());
    return (category === "All terms" || entry.category === category) && (semanticEntries || !needle ||
      normalize([entry.term, entry.expansion, ...entry.aliases, entry.definition, entry.context].filter(Boolean).join(" ")).includes(needle));
  }), [entries, search, category, semanticEntries]);
  const letters = new Set(available.map((entry) => glossaryLetter(entry.term)));
  const shown = available.filter((entry) => !letter || glossaryLetter(entry.term) === letter);
  const references = [...new Map([...entries, ...semanticEntries ?? []].flatMap((entry) => entry.citations).map((cite) => [cite.sourceId, cite])).values()]
    .sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle)).map((cite, index) => ({ ...cite, number: index + 1 }));
  const sourceNumbers = new Map(references.map((source) => [source.sourceId, source]));
  const visibleSourceIds = new Set(shown.flatMap((entry) => entry.citations.map((cite) => cite.sourceId)));
  const groups = new Map<string, Map<string, GlossaryEntry[]>>();
  for (const entry of shown) {
    const initial = glossaryLetter(entry.term);
    if (!groups.has(initial)) groups.set(initial, new Map());
    const terms = groups.get(initial)!;
    const key = normalize(entry.term);
    terms.set(key, [...terms.get(key) ?? [], entry]);
  }
  const selected = selectedKey ? entries.find((entry) => glossaryEntryKey(entry) === selectedKey) ?? null : null;
  const select = (key: string | null) => { setSelectedKey(key); setPreview(null); };
  const error = generation.error?.message || query.error?.message || state?.error;

  return (
    <div className="space-y-5 pb-8">
      <p className="text-panel text-muted-foreground">Terms and definitions from your sources.</p>
      <div className="my-6 flex flex-col gap-4">
        <form onSubmit={(event) => { event.preventDefault(); setLetter(null); meaning.mutate(search); }} className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm [&_input]:pl-8">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input data-tour="glossary-search" type="search" aria-label="Search glossary" value={search} onChange={(event) => { setSearch(event.target.value); setLetter(null); meaning.reset(); }} placeholder="Search terms or describe a meaning…" />
        </div>
          <Button type="submit" variant="outline" disabled={!search.trim() || meaning.isPending}>{meaning.isPending ? "Finding meanings…" : "Search by meaning"}</Button>
        </form>
        {meaning.error && <p role="alert" className="text-xs text-destructive">{meaning.error.message}</p>}
        {semanticEntries && <p role="status" className="text-xs text-muted-foreground">Matched by meaning. <button type="button" className="underline" onClick={() => meaning.reset()}>Use word matching</button></p>}
        <div className="flex flex-wrap gap-1" aria-label="Types of terms">
          {CATEGORIES.map((value, index) => <button key={value} type="button" aria-pressed={category === value} onClick={() => { setCategory(value); setLetter(null); }} className={cn("rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring", category === value ? "border-link/40 bg-link/15 text-link" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground")}>{CATEGORY_LABELS[index]}</button>)}
        </div>
      </div>

      <nav aria-label="Dictionary alphabet" className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-y bg-background/95 py-2 backdrop-blur-sm">
        <button type="button" onClick={() => setLetter(null)} aria-pressed={letter === null} className={cn("mr-1 rounded px-2 py-1.5 text-xs", !letter ? "bg-link/15 font-semibold text-link" : "text-muted-foreground")}>All</button>
        {ALPHABET.map((value) => <button key={value} type="button" aria-label={`Terms beginning with ${value}`} aria-pressed={letter === value} disabled={!letters.has(value)} onClick={() => setLetter(value)} className={cn("min-w-6 rounded px-1.5 py-1.5 font-mono text-xs transition-colors disabled:opacity-25", letter === value ? "bg-link/15 font-semibold text-link ring-1 ring-link/40" : "hover:bg-muted")}>{value}</button>)}
      </nav>

      <div className="flex flex-wrap justify-between gap-2 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{shown.length} {shown.length === 1 ? "definition" : "definitions"}{search || category !== "All terms" || letter ? ` of ${entries.length}` : ""}</span>
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>Dictionary generation needs attention: {error}</p><Button className="mt-3" variant="outline" disabled={busy} onClick={() => generate(false)}>Retry generation</Button></div>}
      {busy && <div role="status" className="flex items-center gap-3 text-panel text-muted-foreground"><Loader inline /><span>Updating glossary…{state?.total_batches ? ` ${state.completed_batches} of ${state.total_batches} groups complete.` : ""}</span></div>}

      {!shown.length && !error && (busy || query.isPending || state?.status === "idle") ? <div className="space-y-8 py-10" aria-label="Dictionary loading">{[1, 2, 3].map((value) => <div key={value} className="animate-pulse space-y-3"><div className="h-6 w-44 rounded bg-muted" /><div className="h-3 w-full rounded bg-muted" /><div className="h-3 w-2/3 rounded bg-muted" /></div>)}</div> : null}
      {!shown.length && state?.status === "ready" && !busy ? <div className="py-16 text-center"><BookOpen className="mx-auto mb-4 size-7 text-muted-foreground" /><p className="text-panel font-medium">{entries.length ? "No matching terms" : "No terms yet"}</p><p className="mt-2 text-sm text-muted-foreground">{entries.length ? "Try another spelling, meaning, or type of term." : "Add sources that explain technical terms, acronyms, or unfamiliar words."}</p>{entries.length > 0 && <Button variant="ghost" className="mt-4" onClick={() => { setSearch(""); setCategory("All terms"); setLetter(null); }}>Clear filters</Button>}</div> : null}

      {[...groups].sort(([a], [b]) => ALPHABET.indexOf(a) - ALPHABET.indexOf(b)).map(([initial, terms]) => <section key={initial} aria-label={`Letter ${initial}`} className="grid grid-cols-[2rem_1fr] gap-4 border-b py-8 sm:grid-cols-[3.5rem_1fr] sm:gap-6">
        <h3 className="sticky top-14 flex size-10 items-center justify-center rounded-md bg-link/10 text-xl font-semibold text-link">{initial}</h3>
        <dl className="min-w-0 divide-y divide-border">
          {[...terms.values()].map((senses) => <DictionaryWord key={normalize(senses[0]!.term)} senses={senses} sourceNumbers={sourceNumbers} selectedKey={selected ? selectedKey : null} preview={preview} onSelect={select} />)}
        </dl>
      </section>)}
      {shown.length > 0 && <section aria-labelledby="glossary-references-title" className="border-t pt-8">
        <h2 id="glossary-references-title" className="mb-4 text-lg font-semibold">References</h2>
        <ol className="list-decimal space-y-3 pl-5 text-xs text-muted-foreground marker:text-faint">
          {references.filter((source) => visibleSourceIds.has(source.sourceId)).map((source) => <li key={source.sourceId} id={`glossary-reference-${source.number}`} value={source.number} className="scroll-mt-20 pl-1 target:bg-hover">
            <Link href={`/sources/${source.sourceId}`} className="hover:text-foreground hover:underline"><cite className="not-italic">{source.sourceTitle}</cite></Link>
          </li>)}
        </ol>
      </section>}
      {selected ? <RightPanelSlot onClose={() => select(null)}><DefinitionPanel key={selectedKey} entry={selected} queryKey={QUERY_KEY} preview={preview} onPreview={setPreview} onRemoved={() => select(null)} /></RightPanelSlot> : null}
    </div>
  );
}

type DictionaryWordProps = { senses: GlossaryEntry[]; sourceNumbers: Map<string, DictionarySource>; selectedKey: string | null; preview: DefinitionPreview | null; onSelect: (key: string | null) => void };
function DictionaryWord({ senses, sourceNumbers, selectedKey, preview, onSelect }: DictionaryWordProps) {
  const head = senses[0]!;
  const client = useQueryClient();
  // Rewrites one definition from the current claims it cites; the rest of the glossary is untouched
  const regeneration = useMutation({
    mutationFn: async (entry: GlossaryEntry) => {
      const result = await regenerateGlossaryDefinition(entry);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const regenerating = regeneration.isPending ? glossaryEntryKey(regeneration.variables) : null;
  const failed = regeneration.isError ? glossaryEntryKey(regeneration.variables) : null;
  return <div className="py-8 first:pt-0 last:pb-0">
    <dt id={glossaryAnchor(head.term)} className="flex scroll-mt-20 flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-lg font-semibold tracking-tight text-foreground">{glossarySentenceCase(head.term)}</span><span className={cn("rounded px-2 py-0.5 text-xs font-medium", CATEGORY_COLORS[head.category])}>{glossarySentenceCase(head.category)}</span></dt>
    {head.expansion && <dd className="mt-2 text-panel font-medium text-muted-foreground">{glossarySentenceCase(head.expansion)}</dd>}
    {senses.map((entry, index) => {
      const sources = [...new Map(entry.citations.map((cite) => [cite.sourceId, cite])).values()].sort((a, b) => (sourceNumbers.get(a.sourceId)?.number ?? 0) - (sourceNumbers.get(b.sourceId)?.number ?? 0));
      const key = glossaryEntryKey(entry);
      const isSelected = key === selectedKey;
      const previewed = preview?.key === key ? preview.definition : null;
      const isRegenerating = regenerating === key;
      // Clicking the definition (not one of its reference links) opens its details and history
      return <dd key={index} className="mt-6">
        <div className="flex items-start justify-between gap-3">
          <p onClick={(event) => { if (!(event.target as HTMLElement).closest("a")) onSelect(isSelected ? null : key); }} className={cn("-mx-2 max-w-2xl cursor-pointer rounded-md px-2 text-sm leading-7 transition-colors hover:bg-hover", isSelected && "bg-muted", (previewed || isRegenerating) && "text-stale")}>{senses.length > 1 && <span className="mr-2 font-mono text-xs text-muted-foreground">{index + 1}.</span>}{previewed ?? entry.definition}{sources.map((cite) => {
            const source = sourceNumbers.get(cite.sourceId);
            return source ? <sup key={source.sourceId} className="ml-1 text-xs leading-none"><Tooltip content={source.sourceTitle}><a href={`#glossary-reference-${source.number}`} aria-label={`Reference ${source.number}: ${source.sourceTitle}`} className="text-muted-foreground hover:text-link hover:underline">[{source.number}]</a></Tooltip></sup> : null;
          })}</p>
          <RowMenu label={`${entry.term} definition ${index + 1}`} items={[
            { label: "Show evidence and history", run: () => onSelect(key) },
            { label: isRegenerating ? "Regenerating…" : "Regenerate definition", isDisabled: regenerating !== null, separatorBefore: true, run: () => regeneration.mutate(entry) },
            { label: "Edit definition", body: (close) => <DefinitionForm entry={entry} close={close} /> },
            { label: "Delete definition", isDestructive: true, body: (close) => <DefinitionForm entry={entry} close={close} deleting /> },
          ]} />
        </div>
        {isRegenerating && <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader inline /><span>Regenerating definition…</span></p>}
        {failed === key && <p role="alert" className="mt-2 text-xs text-destructive">{regeneration.error?.message}</p>}
        {entry.context && <p className="mt-2 text-xs text-muted-foreground">In context: {glossarySentenceCase(entry.context)}</p>}
        {entry.aliases.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Also: {entry.aliases.map(glossarySentenceCase).join(" · ")}</p>}
      </dd>;
    })}
  </div>;
}

function DefinitionForm({ entry, close, deleting = false }: { entry: GlossaryEntry; close: () => void; deleting?: boolean }) {
  const client = useQueryClient();
  const [definition, setDefinition] = useState(entry.definition);
  const mutation = useMutation({
    mutationFn: async () => {
      const result = await changeGlossaryDefinition(entry, deleting ? null : definition);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: QUERY_KEY }); close(); },
  });
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
    <DialogTitle>{deleting ? "Delete definition" : "Edit definition"}</DialogTitle>
    <DialogDescription>{entry.term}. Changes to its sources may replace manual edits when the glossary updates.</DialogDescription>
    {deleting ? <p className="text-panel">Delete this definition from the glossary?</p> : <label className="block space-y-2 text-panel"><span>Definition</span><Textarea value={definition} onChange={(event) => setDefinition(event.target.value)} required maxLength={1000} rows={5} /></label>}
    {mutation.error && <p role="alert" className="text-panel text-destructive">{mutation.error.message}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>Cancel</Button>
      <Button type="submit" variant={deleting ? "destructive" : "default"} disabled={mutation.isPending || (!deleting && !definition.trim())}>{mutation.isPending ? "Saving…" : deleting ? "Delete" : "Save"}</Button>
    </div>
  </form>;
}
