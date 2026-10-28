"use client";

import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { Note, QueryState, Quote, Section, UnitLink } from "@/app/(app)/_components/bits";
import { formatLocation, humanize, readablePassage } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import type { Enums, Tables } from "@/lib/database/types";
import { usePassages } from "@/lib/queries";
import { type PassageAction, type UnitSummary, useActionsForPassages, useUnitSummaries } from "@/lib/queries/screens";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FigureThumbnail, type SourceFigure, sourceFigures } from "./SourceFigures";

// PASSAGES: in order, each with the units its actions produced or changed
export function SourcePassages({ sourceId }: { sourceId: string }) {
  const passages = usePassages({ filters: { source_id: sourceId } });
  const list = passages.data ?? [];
  const [visibleCount, setVisibleCount] = useState(50);
  const targetId = usePassageTarget();
  // Citation links keep working even when the passage is beyond the first page.
  const visible = list.filter((passage, index) => index < visibleCount || passage.id === targetId);
  const actions = useActionsForPassages(visible.map((passage) => passage.id));
  const unitActions = (actions.data ?? []).filter((action) => action.target_id && UNIT_ACTION_TYPES.has(action.type));
  const units = useUnitSummaries(unitActions.map((action) => action.target_id));
  const unitById = useMemo(() => new Map((units.data ?? []).map((unit) => [unit.id, unit])), [units.data]);
  const actionsByPassage = useMemo(() => {
    const byPassage = new Map<string, PassageAction[]>();
    for (const action of unitActions) for (const id of action.passage_ids) {
      const matches = byPassage.get(id);
      if (matches) matches.push(action);
      else byPassage.set(id, [action]);
    }
    return byPassage;
  }, [unitActions]);
  const figureByPassage = useMemo(() => new Map(sourceFigures(passages.data ?? []).flatMap((figure) => figure.passages.map((passage) => [passage.id, figure] as const))), [passages.data]);
  return (
    <Section title={`Passages (${list.length})`}>
      <QueryState query={readsState([passages, actions, units])}>
        {list.length === 0 ? <Note>No passages were extracted.</Note> : null}
        <ol className="flex flex-col gap-4">
          {visible.map((passage) => (
            <PassageItem key={passage.id} passage={passage} figure={figureByPassage.get(passage.id) ?? null} isTarget={passage.id === targetId} actions={actionsByPassage.get(passage.id) ?? []} unitById={unitById} />
          ))}
        </ol>
        {visibleCount < list.length ? <Button variant="outline" onClick={() => setVisibleCount((count) => count + 50)}>Show 50 more</Button> : null}
      </QueryState>
    </Section>
  );
}

// THE LINKED PASSAGE: the id in a #passage-<id> link (a citation chip, a reference). The link lands
// before the passages load, so once that passage is on the page it is scrolled to, once per link.
const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
function usePassageTarget(): string | null {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash, () => "");
  const targetId = hash.startsWith("#passage-") ? hash.slice("#passage-".length) : null;
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!targetId || scrolledTo.current === targetId) return;
    const element = document.getElementById(`passage-${targetId}`);
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    scrolledTo.current = targetId;
  });
  return targetId;
}

type PassageItemProps = { passage: Tables<"passages">; actions: PassageAction[]; unitById: Map<string, UnitSummary> };

// ONE PASSAGE: position and location, the text, then what it produced. A passage describing a
// picture says which figure; the figure's first passage shows its thumbnail.
function PassageItem({ passage, figure, actions, unitById, isTarget }: PassageItemProps & { figure: SourceFigure | null; isTarget: boolean }) {
  const startsFigure = figure?.passages[0]?.id === passage.id;
  return (
    <li id={`passage-${passage.id}`} className={cn("flex scroll-mt-6 flex-col gap-1.5", isTarget && "-mx-2 rounded-md bg-hover px-2 py-1.5 ring-1 ring-link/40")}>
      <p className="flex gap-2 text-xs text-faint">
        <span className="font-mono">#{passage.position}</span>
        <span>{formatLocation(passage.location)}</span>
        {passage.speaker_label ? <span>{passage.speaker_label}</span> : null}
        {figure && !startsFigure ? <span>Describes figure {figure.number}</span> : null}
      </p>
      {figure && startsFigure ? <FigureThumbnail sourceId={passage.source_id} figure={figure} size="sm" /> : null}
      <Quote>{readablePassage(passage.text)}</Quote>
      <ProducedUnits actions={actions} unitById={unitById} />
    </li>
  );
}

// WHAT EACH ACTION DID TO ITS CLAIM, as a short verb and the sentence that explains it
const ACTION_VERBS: Partial<Record<Enums<"action_type">, [verb: string, hint: string]>> = {
  add_claim: ["New", "A new claim was taken from this passage"],
  revise_claim: ["Revised", "An existing claim was reworded using this passage"],
  retire_claim: ["Retired", "This passage led to retiring a claim"],
  link: ["Linked", "This passage linked two claims"],
  set_epistemic_status: ["Status", "This passage changed how certain a claim is"],
  merge_duplicates: ["Merged", "Duplicate claims were merged"],
  place_claim: ["Filed", "A claim from this passage was filed into a topic"],
};

// PRODUCED UNITS: one row per live claim, with everything this passage did to it ("New · revised"),
// then the claim; the glyph is how certain it is. Claims since merged or retired are counted, not listed.
function ProducedUnits({ actions, unitById }: Omit<PassageItemProps, "passage">) {
  if (actions.length === 0) return null;
  const byTarget = new Map<string, PassageAction[]>();
  for (const action of actions) byTarget.set(action.target_id ?? action.id, [...(byTarget.get(action.target_id ?? action.id) ?? []), action]);
  const retired = [...byTarget.keys()].filter((targetId) => unitById.get(targetId)?.retired_at);
  const live = [...byTarget].filter(([targetId]) => !retired.includes(targetId));
  return (
    <ul className="flex flex-col gap-1.5 pl-3">
      {retired.length ? (
        <li className="order-last text-panel text-faint">
          <Tooltip content="Claims from this passage later merged into another or retired">
            <span>{`${retired.length} earlier claim${retired.length === 1 ? "" : "s"} merged or retired`}</span>
          </Tooltip>
        </li>
      ) : null}
      {live.map(([targetId, targetActions]) => {
        const unit = unitById.get(targetId);
        const verbs = targetActions.map((action): [string, string] => ACTION_VERBS[action.type] ?? [humanize(action.type), humanize(action.type)]);
        const label = [...new Set(verbs.map(([verb]) => verb))].map((verb, index) => (index === 0 ? verb : verb.toLowerCase())).join(" · ");
        return (
          <li key={targetId} className="flex items-start gap-2 text-panel">
            <Tooltip content={[...new Set(verbs.map(([, hint]) => hint))].join(". ")}>
              <span className="w-24 shrink-0 text-faint">{label}</span>
            </Tooltip>
            {unit ? <UnitLink unit={unit} /> : <span className="font-mono text-faint">{targetId}</span>}
          </li>
        );
      })}
    </ul>
  );
}
