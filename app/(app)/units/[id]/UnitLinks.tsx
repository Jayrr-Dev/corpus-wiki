"use client";

import { Note, QueryState, Section, UnitLink } from "@/app/(app)/_components/bits";
import { humanize } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import type { Tables } from "@/lib/database/types";
import { type UnitSummary, useUnitRelationships, useUnitSummaries } from "@/lib/queries/screens";
import { cn } from "@/lib/utils";

// LINKS: relationships from this unit and to it, with the unit on the other end
export function UnitLinks({ unitId }: { unitId: string }) {
  const relationships = useUnitRelationships(unitId);
  const list = relationships.data ?? [];
  const otherIds = list.map((link) => (link.from_unit_id === unitId ? link.to_unit_id : link.from_unit_id));
  const others = useUnitSummaries(otherIds);
  const unitById = new Map((others.data ?? []).map((unit) => [unit.id, unit]));
  return (
    <Section title={`Links (${list.length})`}>
      <QueryState query={readsState([relationships, others])}>
        {list.length === 0 ? <Note>No links yet.</Note> : null}
        <ul className="flex flex-col gap-2">
          {list.map((link, index) => (
            <LinkItem key={link.id} link={link} isOutgoing={link.from_unit_id === unitId} other={unitById.get(otherIds[index] ?? "")} />
          ))}
        </ul>
      </QueryState>
    </Section>
  );
}

type LinkItemProps = { link: Tables<"relationships">; isOutgoing: boolean; other: UnitSummary | undefined };

// ONE LINK: "supports →" or "← supports", then the other unit; retired links are faint
function LinkItem({ link, isOutgoing, other }: LinkItemProps) {
  const label = isOutgoing ? `${humanize(link.type)} →` : `← ${humanize(link.type)}`;
  return (
    <li className={cn("grid grid-cols-[8rem_1fr] gap-3 text-panel", link.retired_at && "text-faint")}>
      <span className="text-muted-foreground">{label}</span>
      {other ? <UnitLink unit={other} /> : <span className="font-mono text-faint">{isOutgoing ? link.to_unit_id : link.from_unit_id}</span>}
    </li>
  );
}
