import { createHash } from "node:crypto";
import type { DraftAction, DraftChangeSet, SavedKnowledgeAction } from "@/lib/ai/types";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
export function knowledgeActionKey(action: DraftAction): string {
  return createHash("sha256").update(JSON.stringify(stable(action))).digest("hex");
}

// Only new, cited claims are published early. Revisions and relationships retain
// the original whole-document comparison and are committed after extraction.
export function publishableDraft(draft: DraftChangeSet): DraftChangeSet {
  if (!draft.actions.some((action) => action.type === "add_claim")) return { ...draft, actions: [] };
  return { ...draft, actions: draft.actions.filter((action) => action.type === "add_claim" || action.type === "create_entity") };
}

export class PublishedKnowledge {
  private readonly targets = new Map<string, string>();
  remember(draft: DraftChangeSet, saved: SavedKnowledgeAction[]): void {
    for (const row of saved) {
      const action = draft.actions[row.position];
      if (action && row.outcome === "applied" && row.unitId) this.targets.set(knowledgeActionKey(action), row.unitId);
    }
  }
  remaining(draft: DraftChangeSet): DraftChangeSet {
    const moved = new Map<number, number>();
    const targets = new Map<number, string>();
    const actions = draft.actions.filter((action, position) => {
      const target = this.targets.get(knowledgeActionKey(action));
      if (target) { targets.set(position, target); return false; }
      moved.set(position, moved.size);
      return true;
    }).map((action): DraftAction => {
      if (action.type !== "link") return action;
      const { fromPosition, toPosition, ...input } = action.input;
      const from = fromPosition === undefined ? undefined : targets.get(fromPosition);
      const to = toPosition === undefined ? undefined : targets.get(toPosition);
      return { ...action, targetId: from ?? action.targetId, input: {
        ...input, toUnitId: to ?? input.toUnitId,
        ...(fromPosition === undefined || from ? {} : { fromPosition: moved.get(fromPosition) }),
        ...(toPosition === undefined || to ? {} : { toPosition: moved.get(toPosition) }),
      } };
    });
    return { ...draft, actions };
  }
}
