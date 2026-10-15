"use client";

import { useActorLabel, usePersonName } from "@/app/(app)/_lib/useActorLabel";
import { useChangeSets, useShiftEvent } from "@/lib/queries";

// WHO MADE A SECTION CHANGE: the change set behind the note's event (a person, or the
// AI's model), or the person on the event when no set made it (an undo)
export function useNoteActor(eventId: string): { label: string | null; changeSetId: string | null } {
  const { data: changeSets = [] } = useChangeSets({ filters: { event_id: eventId }, limit: 1 });
  const changeSet = changeSets[0];
  const { data: event } = useShiftEvent(changeSet ? undefined : eventId);
  const label = useActorLabel();
  const eventPerson = usePersonName(event?.person_id);
  if (changeSet) return { label: label(changeSet.proposed_by, changeSet.author_id, changeSet.model_version), changeSetId: changeSet.id };
  return { label: event ? eventPerson ?? (event.actor === "person" ? "Person" : "AI") : null, changeSetId: null };
}
