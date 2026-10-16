import "server-only";

import { addUsage, chatJson, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import {
  buildPlaceTopicsMessages,
  PLACE_TOPICS_BATCH,
  PLACE_TOPICS_PROMPT_VERSION,
  placementActions,
  placeTopicsAnswerSchema,
  placeTopicsJsonSchema,
  readPlacements,
  type PlaceTopicsInput,
  type TopicClaim,
} from "@/lib/ai/tokenFactory/placeTopics";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { workflowStep } from "./workflowContext";

// =====================================================================
// THE TOPIC STEP AS THE APP RUNS IT ("place" in the upload workflow):
// the upload's saved, cleaned claims that have no topic yet are filed in
// one ChangeSet on the upload's own event, so a new root it proposes holds
// the upload on approval exactly like before (upload_workflow_waiting).
// =====================================================================

type Unplaced = { claims: TopicClaim[]; domainPaths: string[]; domainTabs: PlaceTopicsInput["domainTabs"] };

export function topicPlacerFor(db: DbRpc, settings: TokenFactorySettings) {
  return async (eventId: string): Promise<void> => {
    const { claims, domainPaths, domainTabs } = await db.call<Unplaced>("upload_unplaced_claims", { p_event_id: eventId });
    if (!claims.length) return;
    // Slices of a long file are filed in order; each sees the paths the earlier slices chose
    const placed = new Map<string, string[]>();
    const known = new Set(domainPaths);
    let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
    let model: string | null = null;
    for (let start = 0; start < claims.length; start += PLACE_TOPICS_BATCH) {
      const input: PlaceTopicsInput = { sourceTitle: "", claims: claims.slice(start, start + PLACE_TOPICS_BATCH), existingPaths: [...known], domainTabs };
      const answer = await workflowStep(`place:${input.claims[0]!.unitId}`, () => chatJson(settings, {
        name: "place_topics",
        schema: placeTopicsAnswerSchema,
        jsonSchema: placeTopicsJsonSchema,
        messages: buildPlaceTopicsMessages(input),
        // Filing is sorting by meaning; long hidden thinking adds minutes and no better topics
        reasoningEffort: "low",
      }));
      usage = addUsage(usage, answer);
      model = answer.model;
      for (const [unitId, paths] of readPlacements(answer.value, input)) {
        placed.set(unitId, paths);
        for (const path of paths) path.split("/").forEach((_, i, parts) => known.add(parts.slice(0, i + 1).join("/")));
      }
    }
    if (!placed.size) return;
    const actions = placementActions(placed, domainPaths, "Filed together with the rest of the file's claims");
    const { changeSetId } = await submitChangeSet(db, { eventId, cause: "upload", actor: "ai", operationKey: "place:submit" }, {
      summary: `Filed ${placed.size} claim${placed.size === 1 ? "" : "s"} into topics`,
      actions,
      trace: { modelVersion: model, promptVersion: PLACE_TOPICS_PROMPT_VERSION, ...usage },
    });
    await commitChangeSet(db, changeSetId);
  };
}
