import "server-only";
import { skillTrace } from "@/lib/ai/skills/prompt";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import {
  buildLinkMessages,
  type ExistingLink,
  LINK_PROMPT_VERSION,
  linkAnswerJsonSchema,
  linkAnswerSchema,
  linkAnswerToActions,
  linkBatches,
  type LinkPassUnit,
} from "@/lib/ai/tokenFactory/linkPass";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { fetchGraphRows } from "@/lib/graph/rows";
import type { AdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// LINK EXISTING CLAIMS (one-off, re-runnable): claims ingested before
// ingest proposed links have none. The screen plans the batches, then
// runs them one by one (so it can show progress); each batch is one AI
// ChangeSet through Change control, reviewable and undoable on Changes.
// Pairs already linked are skipped here and rejected by check_link.
// =====================================================================

// UNITS PER MODEL CALL: enough to see neighbours, small enough to answer in one go
export const LINK_BATCH_SIZE = 30;

type Deps = { db: DbRpc; client: AdminSupabase; settings: TokenFactorySettings };

export type LinkBatchResult = { changeSetId: string | null; proposed: number; applied: number; rejected: number };

// Every live unit (current wording, domain paths) and every live link
async function loadStore(client: AdminSupabase): Promise<{ units: LinkPassUnit[]; links: ExistingLink[] }> {
  const rows = await fetchGraphRows(client);
  const contentByRevision = new Map(rows.revisions.map((revision) => [revision.id, revision.content]));
  const composite = new Set(rows.revisions.filter((revision) => revision.structure).map((revision) => revision.id));
  const pathByDomain = new Map(rows.domains.map((domain) => [domain.id, domain.path]));
  const pathsByUnit = new Map<string, string[]>();
  for (const { unit_id, domain_id } of rows.unitDomains) {
    const path = pathByDomain.get(domain_id);
    if (path) pathsByUnit.set(unit_id, [...(pathsByUnit.get(unit_id) ?? []), path]);
  }
  return {
    units: rows.units.map((unit) => ({
      unitId: unit.id,
      content: contentByRevision.get(unit.current_revision_id) ?? "",
      kind: unit.kind,
      domainPaths: pathsByUnit.get(unit.id) ?? [],
      composite: composite.has(unit.current_revision_id),
    })).filter((unit) => unit.content.trim()),
    links: rows.relationships.map((r) => ({ fromUnitId: r.from_unit_id, toUnitId: r.to_unit_id, type: r.type })),
  };
}

// PLAN: the batches of unit ids, in the order the screen runs them
export async function planLinkBatches(client: AdminSupabase): Promise<string[][]> {
  const { units } = await loadStore(client);
  return linkBatches(units, LINK_BATCH_SIZE).map((batch) => batch.map((unit) => unit.unitId));
}

// ONE BATCH: the model links the units, Change control commits what it proposed
export async function linkUnitBatch(deps: Deps, unitIds: string[]): Promise<LinkBatchResult> {
  const store = await loadStore(deps.client);
  const wanted = new Set(unitIds);
  const units = store.units.filter((unit) => wanted.has(unit.unitId));
  const empty = { changeSetId: null, proposed: 0, applied: 0, rejected: 0 };
  if (units.length < 2) return empty;
  const existing = store.links.filter((link) => wanted.has(link.fromUnitId) || wanted.has(link.toUnitId));
  const answer = await chatJson(deps.settings, {
    name: "link_existing",
    schema: linkAnswerSchema,
    jsonSchema: linkAnswerJsonSchema,
    messages: buildLinkMessages(units, existing, deps.settings.skills),
  });
  const actions = linkAnswerToActions(answer.value, units, existing);
  if (!actions.length) return empty;
  const { changeSetId } = await submitChangeSet(deps.db, { eventId: null, cause: "edit", actor: "ai" }, {
    summary: `Linked existing claims (${actions.length} link${actions.length === 1 ? "" : "s"} proposed)`,
    actions,
    trace: { modelVersion: answer.model, promptVersion: skillTrace(LINK_PROMPT_VERSION,["link_knowledge"],deps.settings.skills), tokensIn: answer.tokensIn, tokensOut: answer.tokensOut },
  });
  const result = await commitChangeSet(deps.db, changeSetId);
  return { changeSetId, proposed: actions.length, applied: result.applied, rejected: result.rejected };
}
