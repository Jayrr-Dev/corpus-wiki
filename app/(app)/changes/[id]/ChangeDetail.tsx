"use client";

import { Facts, Note, QueryState, Section, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { formatDateTime, formatTokens } from "@/app/(app)/_lib/format";
import { CHANGE_SET_TONE } from "@/app/(app)/_lib/tone";
import type { Tables } from "@/lib/database/types";
import { useChangeSet, useShiftEvent } from "@/lib/queries";
import { ChangeActions } from "./ChangeActions";
import { UndoButton } from "./UndoButton";

// CHANGE DETAIL: summary and trace, Undo, then every action in order
export function ChangeDetail({ changeSetId }: { changeSetId: string }) {
  const query = useChangeSet(changeSetId);
  const changeSet = query.data;
  return (
    <QueryState query={query}>
      {changeSet ? (
        <div className="flex flex-col gap-6">
          <ChangeHeader changeSet={changeSet} />
          <ChangeActions changeSetId={changeSet.id} />
        </div>
      ) : (
        <Note>No change with this id.</Note>
      )}
    </QueryState>
  );
}

// HEADER: the one-line summary, facts about the set, and Undo
function ChangeHeader({ changeSet }: { changeSet: Tables<"change_sets"> }) {
  const { data: event } = useShiftEvent(changeSet.event_id);
  return (
    <Section title="Change set" actions={<UndoButton changeSet={changeSet} />}>
      <p className="text-body">{changeSet.summary}</p>
      <Facts
        items={[
          ["Status", <StatusDot key="status" tone={CHANGE_SET_TONE[changeSet.status]} label={changeSet.status} />],
          ["Proposed by", changeSet.proposed_by],
          ["Cause", <EventCause key="cause" event={event ?? null} />],
          ["Created", <span key="created" className="font-mono">{formatDateTime(changeSet.created_at)}</span>],
          ["Applied", <span key="applied" className="font-mono">{formatDateTime(changeSet.applied_at)}</span>],
          ["Model / prompt", <span key="trace" className="font-mono">{`${changeSet.model_version ?? "—"} / ${changeSet.prompt_version ?? "—"}`}</span>],
          ["Tokens in / out", <span key="tokens" className="font-mono">{formatTokens(changeSet)}</span>],
        ]}
      />
    </Section>
  );
}

// CAUSE: the shift event behind the set, linking to the uploaded source when there is one
function EventCause({ event }: { event: Tables<"shift_events"> | null }) {
  if (!event) return <span className="text-faint">—</span>;
  if (!event.source_id) return <span>{event.cause}</span>;
  return <TextLink href={`/sources/${event.source_id}`}>{event.cause}</TextLink>;
}
