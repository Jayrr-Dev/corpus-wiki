"use client";

import { Note, QueryState, Quote, Section, TextLink } from "@/app/(app)/_components/bits";
import { formatDate, formatLocation } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import type { Tables } from "@/lib/database/types";
import { useRevisions } from "@/lib/queries";
import { useRowsByIds } from "@/lib/queries/screens";

// SOURCES: every passage any revision of the unit cites, with its source
export function UnitSources({ unitId }: { unitId: string }) {
  const cited = useUnitPassages(unitId);
  return (
    <Section title={`Sources (${cited.passages.length})`}>
      <PassageList cited={cited} />
    </Section>
  );
}

export type UnitPassages = ReturnType<typeof useUnitPassages>;

// CITED PASSAGES: the unit's revisions → the passages they cite → those passages' sources
export function useUnitPassages(unitId: string) {
  const revisions = useRevisions({ filters: { unit_id: unitId } });
  const passages = useRowsByIds("passages", (revisions.data ?? []).flatMap((revision) => revision.passage_ids));
  const sources = useRowsByIds("sources", (passages.data ?? []).map((passage) => passage.source_id));
  const sourceById = new Map((sources.data ?? []).map((source) => [source.id, source]));
  return { state: readsState([revisions, passages, sources]), passages: passages.data ?? [], sourceById };
}

// PASSAGE LIST: each cited passage with its source, or a note when there are none
export function PassageList({ cited }: { cited: UnitPassages }) {
  return (
    <QueryState query={cited.state}>
      {cited.passages.length === 0 ? <Note>No passages cited (a person&apos;s direct edit).</Note> : null}
      <ul className="flex flex-col gap-3">
        {cited.passages.map((passage) => (
          <PassageItem key={passage.id} passage={passage} source={cited.sourceById.get(passage.source_id)} />
        ))}
      </ul>
    </QueryState>
  );
}

type PassageItemProps = { passage: Tables<"passages">; source: Tables<"sources"> | undefined };

// ONE CITED PASSAGE: source link, date and location, then the quoted text
function PassageItem({ passage, source }: PassageItemProps) {
  return (
    <li className="flex flex-col gap-1">
      <p className="flex flex-wrap gap-2 text-xs text-faint">
        <TextLink href={`/sources/${passage.source_id}`}>{source?.title ?? "Source"}</TextLink>
        <span className="font-mono">{formatDate(source?.source_date)}</span>
        <span>{formatLocation(passage.location)}</span>
      </p>
      <Quote>{passage.text}</Quote>
    </li>
  );
}
