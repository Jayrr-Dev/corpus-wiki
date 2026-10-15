"use client";

import { useMemo } from "react";
import { UNIT_ACTION_TYPES } from "@/app/(app)/_components/ActionSummary";
import { Note, QueryState, Quote, Section, UnitLink } from "@/app/(app)/_components/bits";
import { formatLocation, humanize } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import type { Tables } from "@/lib/database/types";
import { usePassages } from "@/lib/queries";
import { type UnitSummary, useActionsForPassages, useUnitSummaries } from "@/lib/queries/screens";

// PASSAGES: in order, each with the units its actions produced or changed
export function SourcePassages({ sourceId }: { sourceId: string }) {
  const passages = usePassages({ filters: { source_id: sourceId } });
  const list = passages.data ?? [];
  const actions = useActionsForPassages(list.map((passage) => passage.id));
  const unitActions = (actions.data ?? []).filter((action) => action.target_id && UNIT_ACTION_TYPES.has(action.type));
  const units = useUnitSummaries(unitActions.map((action) => action.target_id));
  const unitById = useMemo(() => new Map((units.data ?? []).map((unit) => [unit.id, unit])), [units.data]);
  return (
    <Section title={`Passages (${list.length})`}>
      <QueryState query={readsState([passages, actions, units])}>
        {list.length === 0 ? <Note>No passages were extracted.</Note> : null}
        <ol className="flex flex-col gap-4">
          {list.map((passage) => (
            <PassageItem key={passage.id} passage={passage} actions={unitActions.filter((a) => a.passage_ids.includes(passage.id))} unitById={unitById} />
          ))}
        </ol>
      </QueryState>
    </Section>
  );
}

type PassageItemProps = { passage: Tables<"passages">; actions: Tables<"actions">[]; unitById: Map<string, UnitSummary> };

// ONE PASSAGE: position and location, the text, then what it produced
function PassageItem({ passage, actions, unitById }: PassageItemProps) {
  return (
    <li id={`passage-${passage.id}`} className="flex scroll-mt-6 flex-col gap-1.5 target:bg-hover">
      <p className="flex gap-2 text-xs text-faint">
        <span className="font-mono">#{passage.position}</span>
        <span>{formatLocation(passage.location)}</span>
        {passage.speaker_label ? <span>{passage.speaker_label}</span> : null}
      </p>
      <Quote>{passage.text}</Quote>
      <ProducedUnits actions={actions} unitById={unitById} />
    </li>
  );
}

// PRODUCED UNITS: the action type and the unit it targets
function ProducedUnits({ actions, unitById }: Omit<PassageItemProps, "passage">) {
  if (actions.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 pl-3">
      {actions.map((action) => {
        const unit = unitById.get(action.target_id ?? "");
        return (
          <li key={action.id} className="flex items-start gap-2 text-panel">
            <span className="w-28 shrink-0 text-muted-foreground">{humanize(action.type)}</span>
            {unit ? <UnitLink unit={unit} /> : <span className="font-mono text-faint">{action.target_id}</span>}
          </li>
        );
      })}
    </ul>
  );
}
