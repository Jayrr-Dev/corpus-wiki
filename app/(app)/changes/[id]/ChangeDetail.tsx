"use client";

import { Facts, Note, QueryState, Section, TextLink } from "@/app/(app)/_components/bits";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { formatTokens } from "@/app/(app)/_lib/format";
import { useActorLabel, usePersonName } from "@/app/(app)/_lib/useActorLabel";
import { CHANGE_SET_TONE } from "@/app/(app)/_lib/tone";
import { uploaderLabel } from "@/app/(app)/_lib/uploaderLabel";
import type { ReactNode } from "react";
import type { Tables } from "@/lib/database/types";
import { useActions, useChangeSet, useShiftEvent } from "@/lib/queries";
import { ChangeActions } from "./ChangeActions";
import { jsonObject, roleLabel } from "../../decisions/describeDecision";
import { UndoButton } from "./UndoButton";
import { UploadWorkflowStatus } from "@/components/upload/UploadWorkflowStatus";

// CHANGE DETAIL: summary and trace, Undo, then every action in order
export function ChangeDetail({ changeSetId }: { changeSetId: string }) {
  const query = useChangeSet(changeSetId);
  const changeSet = query.data;
  return (
    <QueryState query={query}>
      {changeSet ? (
        <div className="flex flex-col gap-6">
          <ChangeHeader changeSet={changeSet} />
          <UploadWorkflowStatus eventId={changeSet.event_id} allowRetry={changeSet.status !== "reverted"} />
          <ChangeActions changeSetId={changeSet.id} />
        </div>
      ) : (
        <Note>No change with this id.</Note>
      )}
    </QueryState>
  );
}

// UNDONE BY: the person on the undo event of a reverted set (its actions point at that event)
function useUndoneBy(changeSet: Tables<"change_sets">): string | null {
  const actions = useActions({ filters: { change_set_id: changeSet.id } }).data;
  const undoEventId = changeSet.status === "reverted" ? actions?.find((action) => action.reverted_by_event_id)?.reverted_by_event_id ?? undefined : undefined;
  const { data: undo } = useShiftEvent(undoEventId);
  const name = usePersonName(undo?.person_id);
  if (!undo) return null;
  return name ?? "Person";
}

// HEADER: the one-line summary, facts about the set, and Undo
function ChangeHeader({ changeSet }: { changeSet: Tables<"change_sets"> }) {
  const { data: event } = useShiftEvent(changeSet.event_id);
  const label = useActorLabel();
  const starter = usePersonName(event?.person_id);
  const undoneBy = useUndoneBy(changeSet);
  const attribution = jsonObject(changeSet.actor_attribution);
  return (
    <Section title={changeSet.actor_attribution ? "Decision" : "Change set"} actions={<UndoButton changeSet={changeSet} />}>
      <p className="text-body">{changeSet.summary}</p>
      <Facts
        items={([
          ["Status", <StatusDot key="status" tone={CHANGE_SET_TONE[changeSet.status]} label={changeSet.status} />],
          ["Proposed by", roleLabel(attribution.proposedBy) ?? label(changeSet.proposed_by, changeSet.author_id, changeSet.model_version)],
          ["Decided by", roleLabel(attribution.decidedBy)],
          // An AI change a person set off (an upload, an article update): who started it, or the API or agent key
          ["Started by", changeSet.proposed_by === "ai" ? uploaderLabel(event && { person_id: event.person_id, via: event.via }, starter) : null],
          ["Undone by", undoneBy],
          ["Cause", <EventCause key="cause" event={event ?? null} />],
          ["Created", <span key="created" className="font-mono"><DateTime iso={changeSet.created_at} /></span>],
          ["Applied", <span key="applied" className="font-mono"><DateTime iso={changeSet.applied_at} /></span>],
          ["Model / prompt", <span key="trace" className="font-mono">{`${changeSet.model_version ?? "—"} / ${changeSet.prompt_version ?? "—"}`}</span>],
          ["Tokens in / out", <span key="tokens" className="font-mono">{formatTokens(changeSet)}</span>],
        ] satisfies [string, ReactNode][]).filter(([, value]) => value !== null)}
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
