"use client";

import type { ReactNode } from "react";
import { Facts, Note, QueryState, Section, TextLink, UnitLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { formatBytes, formatDate, formatDateTime } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { SOURCE_STATE_TONE } from "@/app/(app)/_lib/tone";
import type { Tables } from "@/lib/database/types";
import { sourceState } from "@/lib/knowledge/evidence";
import { useSource, useSources } from "@/lib/queries";
import { useSourceUnitIds, useUnitSummaries } from "@/lib/queries/screens";
import { SourceRowMenu } from "../SourceRowMenu";
import { SourcePassages } from "./SourcePassages";

// SOURCE DETAIL: what the file is, the knowledge that cites it, then its passages
export function SourceDetail({ sourceId }: { sourceId: string }) {
  const query = useSource(sourceId);
  const source = query.data;
  return (
    <QueryState query={query}>
      {source ? (
        <div className="flex flex-col gap-6">
          <SourceHeader source={source} />
          <SourceKnowledge sourceId={source.id} />
          <SourcePassages sourceId={source.id} />
        </div>
      ) : (
        <Note>No source with this id. It may have been deleted.</Note>
      )}
    </QueryState>
  );
}

// HEADER: title, state, versions, dates and type, with the source's "…" menu
function SourceHeader({ source }: { source: Tables<"sources"> }) {
  const state = sourceState(source);
  const versions = useSources();
  const newer = versions.data?.find((other) => other.id === source.replaced_by_id);
  const older = (versions.data ?? []).filter((other) => other.replaced_by_id === source.id);
  const facts: [string, ReactNode][] = [["State", <StatusDot key="state" tone={SOURCE_STATE_TONE[state]} label={state} />]];
  if (newer) facts.push(["Replaced by", <TextLink key="newer" href={`/sources/${newer.id}`}>{newer.title}</TextLink>]);
  if (older.length > 0) {
    facts.push(["Replaces", (
      <span key="older" className="flex flex-col">
        {older.map((other) => <TextLink key={other.id} href={`/sources/${other.id}`}>{other.title}</TextLink>)}
      </span>
    )]);
  }
  facts.push(
    ["Source date", <span key="date" className="font-mono">{formatDate(source.source_date)}</span>],
    ["Uploaded", <span key="uploaded" className="font-mono">{formatDateTime(source.created_at)}</span>],
  );
  if (source.archived_at) facts.push(["Archived", <span key="archived" className="font-mono">{formatDateTime(source.archived_at)}</span>]);
  facts.push(["Type", <span key="type" className="font-mono">{source.mime_type}</span>]);
  if (source.page_count !== null) facts.push(["Pages", <span key="pages" className="font-mono">{source.page_count}</span>]);
  if (source.byte_size !== null) facts.push(["Size", <span key="size" className="font-mono">{formatBytes(source.byte_size)}</span>]);
  return (
    <Section title="File" actions={<SourceRowMenu source={source} />}>
      <p className="text-body font-medium">{source.title}</p>
      <Facts items={facts} />
    </Section>
  );
}

// KNOWLEDGE: every unit whose current version cites this file, with its evidence state
function SourceKnowledge({ sourceId }: { sourceId: string }) {
  const unitIds = useSourceUnitIds(sourceId);
  const units = useUnitSummaries(unitIds.data ?? []);
  const list = (units.data ?? []).filter((unit) => !unit.retired_at);
  return (
    <Section title={`Knowledge from this file (${list.length})`}>
      <QueryState query={readsState([unitIds, units])}>
        {list.length === 0 ? <Note>No current knowledge cites this file.</Note> : null}
        <ul className="flex flex-col gap-1.5">
          {list.map((unit) => (
            <li key={unit.id}>
              <UnitLink unit={unit} />
            </li>
          ))}
        </ul>
      </QueryState>
    </Section>
  );
}
