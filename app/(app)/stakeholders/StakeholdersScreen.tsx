"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Loader } from "@/components/standard/loader";
import { startProgress } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/queries";
import { useRealtimeInvalidation } from "@/lib/realtime";
import { cardKind, kindPlural, type StakeholderCard as Card } from "@/lib/stakeholders/cards";
import type { StructureRelation } from "@/lib/stakeholders/structure";
import { lookUpStakeholderBatch, planStakeholderPass, planStakeholderSaves, planStakeholderWebPass, saveStakeholderWebPage, tidyEntities, writeStakeholderBatch } from "@/lib/server-actions/stakeholders";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { computePower } from "./power";
import { StakeholderCard } from "./StakeholderCard";
import { StakeholderStructure } from "./StakeholderStructure";
import { buildStructure } from "./structureTree";

export const CARDS_KEY = [...queryKeys.table("entity_profiles"), "cards"] as const;
const MISSING_KEY = [...queryKeys.table("entity_profiles"), "missing"] as const;
// Under entity_profiles so a card change refreshes the links too
const STRUCTURE_KEY = [...queryKeys.table("entity_profiles"), "structure"] as const;
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en");

// Every card, for this screen and the detail page
export function useStakeholderCards() {
  useRealtimeInvalidation("entity_profiles");
  return useQuery({
    queryKey: CARDS_KEY,
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().rpc("stakeholder_cards" as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Card[];
    },
  });
}

// Every structure link between stakeholders. A missing or failing RPC reads as no links, so the
// page still works before the database has them.
export function useStakeholderStructure() {
  return useQuery({
    queryKey: STRUCTURE_KEY,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().rpc("stakeholder_structure" as never);
      if (error) return [];
      return (data ?? []) as unknown as StructureRelation[];
    },
  });
}

// STAKEHOLDERS (/stakeholders): one card per party in the knowledge, grouped by the kind the
// card writer gave it; search, a filter per kind, a sort by Power Level, a Structure view (the
// nested map), and a pass that brings the cards up to date
export function StakeholdersScreen() {
  const cards = useStakeholderCards();
  const structure = useStakeholderStructure();
  const missing = useQuery({
    queryKey: MISSING_KEY,
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().rpc("entity_profiles_missing" as never);
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
  });
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [view, setView] = useState<"cards" | "structure">("cards");
  const [byPower, setByPower] = useState(false);
  const all = useMemo(() => cards.data ?? [], [cards.data]);
  const relations = useMemo(() => structure.data ?? [], [structure.data]);
  const power = useMemo(() => computePower(all, relations), [all, relations]);
  const hiddenCount = all.filter((card) => card.hidden).length;
  const visible = all.filter((card) => showHidden || !card.hidden);

  // Filters come from the data: every kind in use, busiest first
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of visible) counts.set(cardKind(card), (counts.get(cardKind(card)) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [visible]);
  const needle = normalize(search.trim());
  const shown = visible.filter((card) => (!kind || cardKind(card) === kind) && (!needle || normalize([
    card.name, ...card.aliases, card.kind ?? "", card.type, card.relation ?? "", card.description ?? "",
    ...card.keyFacts.map((fact) => `${fact.label} ${fact.value}`), ...card.functions.map((fn) => fn.text),
  ].join(" ")).includes(needle)));
  const scoreOf = (entityId: string) => power.get(entityId)?.score ?? 0;
  const ordered = byPower ? [...shown].sort((a, b) => scoreOf(b.entityId) - scoreOf(a.entityId) || a.name.localeCompare(b.name)) : shown;
  const groups = kinds.map(([name]) => [name, ordered.filter((card) => cardKind(card) === name)] as const).filter(([, list]) => list.length > 0);
  const map = view === "structure" ? buildStructure(shown, relations, scoreOf) : null;

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-panel text-muted-foreground">The companies, agencies, people and roles your sources mention, and how they relate to the work.</p>
        <UpdateCardsButton missing={missing.data ?? 0} />
      </div>

      <div className="flex flex-col gap-4">
        <div className="relative w-full max-w-sm [&_input]:pl-8">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Search stakeholders" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, roles, facts…" />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <div className="flex gap-1 rounded-md border p-0.5" role="group" aria-label="View">
            <KindChip active={view === "cards"} onClick={() => setView("cards")}>Cards</KindChip>
            <KindChip active={view === "structure"} onClick={() => setView("structure")}>Structure</KindChip>
          </div>
          {view === "cards" && <KindChip active={byPower} onClick={() => setByPower(!byPower)}>Sort by power</KindChip>}
        </div>
        {kinds.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Kinds of stakeholders">
            <KindChip active={kind === null} onClick={() => setKind(null)}>All <span className="text-faint">{visible.length}</span></KindChip>
            {kinds.map(([name, count]) => (
              <KindChip key={name} active={kind === name} onClick={() => setKind(kind === name ? null : name)}>
                {kindPlural(name)} <span className="text-faint">{count}</span>
              </KindChip>
            ))}
            {hiddenCount > 0 && (
              <KindChip active={showHidden} onClick={() => setShowHidden(!showHidden)}>Show hidden <span className="text-faint">{hiddenCount}</span></KindChip>
            )}
          </div>
        )}
      </div>

      <ErrorNote error={cards.error?.message} />
      {cards.isPending ? <div className="py-10"><Loader /></div> : null}
      {!cards.isPending && shown.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="mx-auto mb-4 size-7 text-muted-foreground" />
          <p className="text-panel font-medium">{all.length ? "No matching stakeholders" : "No stakeholder cards yet"}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {all.length ? "Try another name, or clear the filter." : "Update cards to write them from your knowledge; new uploads keep them current."}
          </p>
          {all.length > 0 && <Button variant="ghost" className="mt-4" onClick={() => { setSearch(""); setKind(null); }}>Clear filters</Button>}
        </div>
      ) : null}

      {map && shown.length > 0 && <StakeholderStructure structure={map} power={power} />}

      {!map && groups.map(([name, list]) => (
        <section key={name} aria-label={kindPlural(name)} className="space-y-3 border-t pt-5">
          <h2 className="text-sm font-semibold">{kindPlural(name)} <span className="font-normal text-faint">{list.length}</span></h2>
          <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {list.map((card) => <li key={card.entityId}><StakeholderCard card={card} power={power.get(card.entityId)} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function KindChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-link/40 bg-link/15 text-link" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {children}
    </button>
  );
}

// Web lookups and page saves wait on the network and the model, not on each other: a few run at once
const PARALLEL = 3;
async function inParallel<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) await run(items[next++]!); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

type Progress = { done: number; total: number; written: number; failed: number; found: number; saved: number; phase: "cards" | "web" | "save" };

// UPDATE CARDS: tidy the entities (merge sure duplicates, retire unused ones), then write every
// card that is missing or whose claims changed, one batch at a time with progress
function UpdateCardsButton({ missing }: { missing: number }) {
  const tidy = useServerAction(tidyEntities, { progress: false });
  const plan = useServerAction(planStakeholderPass, { progress: false });
  const write = useServerAction(writeStakeholderBatch, { progress: false });
  const planWeb = useServerAction(planStakeholderWebPass, { progress: false });
  const lookUp = useServerAction(lookUpStakeholderBatch, { progress: false });
  const planSaves = useServerAction(planStakeholderSaves, { progress: false });
  const savePage = useServerAction(saveStakeholderWebPage, { progress: false });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const running = tidy.isPending || plan.isPending || planWeb.isPending || planSaves.isPending || (progress !== null && progress.done < progress.total);

  const run = async () => {
    setBatchError(null);
    const toast = startProgress("Updating stakeholder cards", "Tidying entities…");
    const tidied = await tidy.run();
    if (!tidied.ok) return toast.fail();
    toast.update("Finding cards to write…", 0);
    const planned = await plan.run();
    if (!planned.ok) return toast.fail();
    let current: Progress = { done: 0, total: planned.batches.length, written: 0, failed: 0, found: 0, saved: 0, phase: "cards" };
    setProgress(current);
    for (const batch of planned.batches) {
      const result = await write.run(batch);
      if (!result.ok) setBatchError(result.error);
      current = { ...current, done: current.done + 1, written: current.written + (result.ok ? result.written : 0), failed: current.failed + (result.ok ? 0 : 1) };
      setProgress(current);
      toast.update(`Wrote ${current.done} of ${current.total} batches`, current.done / current.total);
    }
    // Then the web: new stakeholders are looked up (only while external knowledge is allowed)
    toast.update("Finding stakeholders to look up on the web…", 1);
    const webPlan = await planWeb.run();
    if (webPlan.ok && webPlan.batches.length) {
      current = { ...current, phase: "web", done: 0, total: webPlan.batches.length };
      setProgress(current);
      await inParallel(webPlan.batches, PARALLEL, async (batch) => {
        const result = await lookUp.run(batch);
        if (!result.ok) setBatchError(result.error);
        current = { ...current, done: current.done + 1, found: current.found + (result.ok ? result.found : 0), failed: current.failed + (result.ok ? 0 : 1) };
        setProgress(current);
        toast.update(`Looked up ${current.done} of ${current.total} batches on the web`, current.done / current.total);
      });
    }
    // Then each confirmed page not yet saved becomes external knowledge (approved, stored, reconciled)
    const saves = await planSaves.run();
    if (saves.ok && saves.entityIds.length) {
      current = { ...current, phase: "save", done: 0, total: saves.entityIds.length };
      setProgress(current);
      await inParallel(saves.entityIds, PARALLEL, async (entityId) => {
        const result = await savePage.run(entityId);
        if (!result.ok) setBatchError(result.error);
        current = { ...current, done: current.done + 1, saved: current.saved + (result.ok && result.saved ? 1 : 0), failed: current.failed + (result.ok ? 0 : 1) };
        setProgress(current);
        toast.update(`Saved web knowledge for ${current.done} of ${current.total} stakeholders`, current.done / current.total);
      });
    }
    const parts = [
      tidied.applied ? `${tidied.applied} entit${tidied.applied === 1 ? "y" : "ies"} tidied` : "",
      current.written ? `${current.written} card${current.written === 1 ? "" : "s"} written` : "Every card is up to date",
      current.found ? `${current.found} found on the web` : "",
      current.saved ? `${current.saved} page${current.saved === 1 ? "" : "s"} saved as external knowledge` : "",
      current.failed ? `${current.failed} batch${current.failed === 1 ? "" : "es"} failed` : "",
    ].filter(Boolean);
    toast.done(parts.join(" · "));
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={running} onClick={() => void run()}>
        {tidy.isPending ? "Tidying…" : plan.isPending ? "Planning…" : running && progress ? `${progress.phase === "web" ? "Looking up" : progress.phase === "save" ? "Saving" : "Writing"} ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : missing > 0 ? `Write ${missing} missing card${missing === 1 ? "" : "s"}` : "Update cards"}
      </Button>
      <ErrorNote error={tidy.error ?? plan.error ?? planWeb.error ?? batchError} />
    </div>
  );
}
