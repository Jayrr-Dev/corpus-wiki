import { expect, it } from "vitest";
import type { DraftChangeSet } from "@/lib/ai/types";
import { PublishedKnowledge, publishableDraft } from "./incrementalDraft";

it("retains evidence and translates final relationship positions to saved unit IDs", () => {
  const claim = (content: string) => ({ type: "add_claim" as const, targetId: null, expectedRevisionId: null, passageIds: ["passage"], speechAct: "stated" as const,
    input: { content, kind: "fact" as const, epistemicStatus: "supported" as const, validFrom: "2026-10-18", entities: [], domainPaths: [] } });
  const draft: DraftChangeSet = { summary: "Book", trace: { modelVersion: "test", promptVersion: "test", tokensIn: 1, tokensOut: 1 }, actions: [claim("First"), claim("Second"),
    { type: "link", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { fromPosition: 1, toPosition: 0, toUnitId: null, type: "part_of", memberPosition: 2 } }] };
  const state = new PublishedKnowledge();
  const early = publishableDraft(draft);
  expect(early.actions).toHaveLength(2);
  state.remember(early, [{ position: 0, unitId: "first-unit", type: "add_claim", outcome: "applied" }]);
  const partial = state.remaining(draft);
  expect(partial.actions[0]).toEqual(draft.actions[1]);
  expect(partial.actions[1]).toMatchObject({ targetId: null, input: { fromPosition: 0, toUnitId: "first-unit", memberPosition: 2 } });
  state.remember(early, [{ position: 1, unitId: "second-unit", type: "add_claim", outcome: "applied" }]);
  expect(state.remaining(draft).actions).toEqual([{ ...draft.actions[2], targetId: "second-unit", input: { toUnitId: "first-unit", type: "part_of", memberPosition: 2 } }]);
});
