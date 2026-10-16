"use client";

import { Note, QueryState, Section, UnitLink } from "@/app/(app)/_components/bits";
import { humanize } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import type { Structure } from "@/lib/ai/types";
import type { Tables } from "@/lib/database/types";
import { type UnitSummary, useUnitRelationships, useUnitSummaries } from "@/lib/queries/screens";
import { cn } from "@/lib/utils";

// LINKS: relationships from this unit and to it, with the unit on the other end.
// A composite (a procedure, a list) shows its live steps or items first, in order;
// other units keep their part_of links in the Links list.
export function UnitLinks({ unitId, structure }: { unitId: string; structure?: Structure | null }) {
  const relationships = useUnitRelationships(unitId);
  const all = relationships.data ?? [];
  const steps = structure
    ? all
        .filter((link) => link.type === "part_of" && link.to_unit_id === unitId && !link.retired_at)
        .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at))
    : [];
  const list = all.filter((link) => !steps.includes(link));
  const otherIds = all.map((link) => (link.from_unit_id === unitId ? link.to_unit_id : link.from_unit_id));
  const others = useUnitSummaries(otherIds);
  const unitById = new Map((others.data ?? []).map((unit) => [unit.id, unit]));
  const ordered = structure?.type === "sequence";
  return (
    <>
      {structure ? (
        <Section title={`${ordered ? "Steps" : "Items"} (${steps.length})`}>
          <QueryState query={readsState([relationships, others])}>
            {steps.length === 0 ? <Note>No {ordered ? "steps" : "items"} yet.</Note> : null}
            <ul className="flex flex-col gap-2">
              {steps.map((link, index) => {
                const step = unitById.get(link.from_unit_id);
                return (
                  <li key={link.id} className="grid grid-cols-[2rem_1fr] gap-3 text-panel">
                    <span className="font-mono text-muted-foreground">{ordered ? `${index + 1}.` : "·"}</span>
                    {step ? <UnitLink unit={step} /> : <span className="font-mono text-faint">{link.from_unit_id}</span>}
                  </li>
                );
              })}
            </ul>
            <Note>{compositeNote(structure)}</Note>
          </QueryState>
        </Section>
      ) : null}
      <Section title={`Links (${list.length})`}>
        <QueryState query={readsState([relationships, others])}>
          {list.length === 0 ? <Note>No links yet.</Note> : null}
          <ul className="flex flex-col gap-2">
            {list.map((link) => (
              <LinkItem key={link.id} link={link} isOutgoing={link.from_unit_id === unitId} other={unitById.get(link.from_unit_id === unitId ? link.to_unit_id : link.from_unit_id)} />
            ))}
          </ul>
        </QueryState>
      </Section>
    </>
  );
}

// What the list promises: whether it is the whole list, and for a set how its items combine
function compositeNote({ type, complete, mode }: Structure): string {
  const whole = complete ? "The source gives this as the whole list." : "The source may list more.";
  if (type === "sequence") return whole;
  return `${mode === "all" ? "Every item applies." : mode === "any" ? "Any one item is enough." : "The source does not say how the items combine."} ${whole}`;
}

type LinkItemProps ={ link: Tables<"relationships">; isOutgoing: boolean; other: UnitSummary | undefined };

// ONE LINK: "supports →" or "← supports", then the other unit; retired links are faint
function LinkItem({ link, isOutgoing, other }: LinkItemProps) {
  const step = link.type === "part_of" && link.position !== null;
  const label = isOutgoing ? (step ? `step ${link.position} of →` : `${humanize(link.type)} →`) : `← ${humanize(link.type)}`;
  return (
    <li className={cn("grid grid-cols-[8rem_1fr] gap-3 text-panel", link.retired_at && "text-faint")}>
      <span className="text-muted-foreground">{label}</span>
      {other ? <UnitLink unit={other} /> : <span className="font-mono text-faint">{isOutgoing ? link.to_unit_id : link.from_unit_id}</span>}
    </li>
  );
}
