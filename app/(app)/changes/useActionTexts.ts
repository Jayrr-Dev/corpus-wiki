"use client";

import type { Tables } from "@/lib/database/types";
import { useRowsByIds } from "@/lib/queries/screens";

type Action = Tables<"actions">;

// TEXT BEFORE AND AFTER EACH ACTION: a line action's line revisions (a removal
// keeps the removed line as its "before"), otherwise its unit revisions.
// null on a side the action did not write (nothing before a new line).
export function useActionTexts(actions: readonly Action[]) {
  const lineRevisions = useRowsByIds("line_revisions", actions.flatMap((action) => [action.before_line_revision_id, action.after_line_revision_id]));
  const revisions = useRowsByIds("revisions", actions.flatMap((action) => [action.before_revision_id, action.after_revision_id]));
  const contentById = new Map([...(revisions.data ?? []), ...(lineRevisions.data ?? [])].map((revision) => [revision.id, revision.content]));
  const contentOf = (id: string | null) => (id ? (contentById.get(id) ?? null) : null);
  const isLine = (action: Action) => Boolean(action.before_line_revision_id || action.after_line_revision_id);
  const textsOf = (action: Action) =>
    isLine(action)
      ? { before: contentOf(action.before_line_revision_id), after: contentOf(action.after_line_revision_id) }
      : { before: contentOf(action.before_revision_id), after: contentOf(action.after_revision_id) };
  return { queries: [lineRevisions, revisions] as const, textsOf };
}
