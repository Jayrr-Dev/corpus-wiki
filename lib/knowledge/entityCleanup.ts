import "server-only";

import { addUsage, chatJson, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import {
  buildCleanupMessages,
  type CleanupEntity,
  cleanupAnswerJsonSchema,
  cleanupAnswerSchema,
  duplicateCandidates,
  ENTITY_CLEANUP_PROMPT_VERSION,
  readMerges,
} from "@/lib/ai/tokenFactory/entityCleanup";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { workflowStep } from "@/lib/ingest/workflowContext";

// =====================================================================
// ENTITY CLEANUP AS THE APP RUNS IT ("tidy" in the upload workflow, and
// the Stakeholders page's tidy pass): one AI ChangeSet that merges sure
// duplicates and retires entities nothing uses. Change control lets both
// through without a person (housekeeping, undoable from Changes).
// =====================================================================

// GROUPS PER JUDGE CALL
const GROUPS_PER_CALL = 12;

// applied: how many merges and retires Change control let through (a racing edit can reject one)
export type CleanupResult = { applied: number };

// eventId: the upload to attach the ChangeSet to, and whose entities scope the duplicate search;
// null runs over every entity on a new event (the Stakeholders page)
export async function cleanUpEntities(db: DbRpc, settings: TokenFactorySettings, eventId: string | null): Promise<CleanupResult> {
  const entities = await db.call<CleanupEntity[]>("entity_cleanup_input");
  const focus = eventId ? new Set(await db.call<string[]>("event_touched_entities", { p_event_id: eventId })) : null;
  const groups = duplicateCandidates(entities, focus);

  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  let model: string | null = null;
  const merges: ReturnType<typeof readMerges> = [];
  for (let start = 0; start < groups.length; start += GROUPS_PER_CALL) {
    const slice = groups.slice(start, start + GROUPS_PER_CALL);
    const answer = await workflowStep(`tidy:${slice[0]![0]!.id}`, () => chatJson(settings, {
      name: "entity_cleanup",
      schema: cleanupAnswerSchema,
      jsonSchema: cleanupAnswerJsonSchema,
      messages: buildCleanupMessages(slice),
      reasoningEffort: "low",
    }));
    usage = addUsage(usage, answer);
    model = answer.model;
    merges.push(...readMerges(answer.value, slice));
  }

  // A merged entity's claims move to the one that stays, so only what is still unused is retired
  const mergedAway = new Set(merges.map((merge) => merge.from.id));
  const unused = entities.filter((entity) => !entity.inUse && !mergedAway.has(entity.id));
  const actions: DraftAction[] = [
    ...merges.map((merge): DraftAction => ({
      type: "merge_entity", targetId: merge.from.id, expectedRevisionId: null, passageIds: [], speechAct: null,
      input: { intoEntityId: merge.into.id, reason: `${merge.from.name} (${merge.from.type}) is ${merge.into.name} (${merge.into.type}): ${merge.reason}`, autoMerge: true },
    })),
    ...unused.map((entity): DraftAction => ({
      type: "retire_entity", targetId: entity.id, expectedRevisionId: null, passageIds: [], speechAct: null,
      input: { reason: `No live claim, page or topic uses ${entity.name} (${entity.type})`, housekeeping: true },
    })),
  ];
  if (!actions.length) return { applied: 0 };
  const parts = [merges.length ? `merged ${merges.length} duplicate entit${merges.length === 1 ? "y" : "ies"}` : "", unused.length ? `retired ${unused.length} unused entit${unused.length === 1 ? "y" : "ies"}` : ""].filter(Boolean);
  const { changeSetId } = await submitChangeSet(db, { eventId, cause: eventId ? "upload" : "edit", actor: "ai", operationKey: "tidy:submit" }, {
    summary: `Tidied entities: ${parts.join(" and ")}`,
    actions,
    trace: { modelVersion: model, promptVersion: model ? ENTITY_CLEANUP_PROMPT_VERSION : null, ...(model ? usage : { tokensIn: null, tokensOut: null }) },
  });
  const result = await commitChangeSet(db, changeSetId);
  return { applied: result.applied };
}
