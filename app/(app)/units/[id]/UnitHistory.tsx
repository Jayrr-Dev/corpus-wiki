"use client";

import { Note, QueryState, Section } from "@/app/(app)/_components/bits";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { formatDate } from "@/app/(app)/_lib/format";
import { useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { DiffView } from "@/components/diff/DiffView";
import type { Tables } from "@/lib/database/types";
import { useRevisions } from "@/lib/queries";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { contextDescription } from "@/lib/knowledge/contextSelection";

// HISTORY: every revision, newest first, each diffed against the one before it
export function UnitHistory({ unitId }: { unitId: string }) {
  const query = useRevisions({ filters: { unit_id: unitId } });
  const revisions = query.data ?? [];
  return (
    <Section title={`History (${revisions.length})`}>
      <QueryState query={query}>
        {revisions.length === 0 ? <Note>No revisions.</Note> : null}
        <ol className="flex flex-col gap-3">
          {revisions.map((revision, index) => (
            <RevisionItem key={revision.id} revision={revision} previous={revisions[index + 1] ?? null} />
          ))}
        </ol>
      </QueryState>
    </Section>
  );
}

type RevisionItemProps = { revision: Tables<"revisions">; previous: Tables<"revisions"> | null };

// ONE REVISION: when and by whom, then the change from the previous text
function RevisionItem({ revision, previous }: RevisionItemProps) {
  const label = useActorLabel();
  const context = parseKnowledgeContext(revision.knowledge_context);
  return (
    <li className="flex flex-col gap-1">
      <p className="flex gap-2 font-mono text-xs text-faint">
        <span><DateTime iso={revision.created_at} /></span>
        <span>{label(revision.author, revision.author_id, revision.model_version)}</span>
        <span>source date {formatDate(revision.source_date)}</span>
      </p>
      <DiffView before={previous?.content ?? null} after={revision.content} />
      <p className="text-panel text-muted-foreground">{context ? contextDescription(context) : "Historical context not recorded"}</p>
      {context && <p className="text-panel text-faint">About: {context.entities.map(entity => `${entity.key} (${entity.role})`).join(", ") || "None recorded"}</p>}
    </li>
  );
}
