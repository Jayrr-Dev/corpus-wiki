import type { DraftChangeSet } from "@/lib/ai/types";

// External enrichment cannot grow the taxonomy or leave unused entities behind.
export function scopeExternalDraft(draft: DraftChangeSet, existingPaths: string[]): DraftChangeSet {
  const known = new Map(existingPaths.map((path) => [path.toLowerCase(), path]));
  const claims = draft.actions.flatMap((action) => {
    if (action.type !== "add_claim") return [];
    const domainPaths = [...new Set(action.input.domainPaths.flatMap((path) => known.get(path.toLowerCase()) ?? []))];
    return domainPaths.length ? [{ ...action, input: { ...action.input, domainPaths } }] : [];
  });
  const used = new Set(claims.flatMap((action) => action.input.entities.map((entity) => `${entity.type}:${entity.key}`)));
  return { ...draft, actions: [
    ...draft.actions.filter((action) => action.type === "create_entity" && used.has(`${action.input.type}:${action.input.key}`)),
    ...claims,
  ] };
}
