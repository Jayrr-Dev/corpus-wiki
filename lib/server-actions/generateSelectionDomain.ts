"use server";

import { z } from "zod";
import { chatJson, tokenFactoryFromEnv } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import { readModelChoice } from "@/lib/ai/models";
import { requireUser } from "@/lib/auth/requireUser";
import { commitPersonEdit } from "@/lib/change-control";
import { supabaseRpc } from "@/lib/db/rpc";
import {
  SELECTION_DOMAIN_RULES,
  aiSelectionDomainPlanSchema,
  assertSelectionUnchanged,
  claimStays,
  nearbyDomainIds,
  resolveSelectionDomainPlan,
  selectionDomainEvidence,
  selectionDomainPlanSchema,
  type SelectionClaim,
  type SelectionDomainPlan,
} from "@/lib/domains/selectionDomainPlan";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { toActionResult } from "./result";

const unitIdsSchema = z.array(z.uuid()).min(1).max(300);

function asError(error: unknown) {
  if (error instanceof Error) return error;
  if (error && typeof error === "object" && "message" in error) return new Error(String(error.message));
  return new Error(String(error));
}

async function loadSelection(unitIds: string[]) {
  const ids = [...new Set(unitIdsSchema.parse(unitIds))];
  const client = getAdminSupabase();
  const [units, domainRows] = await Promise.all([
    readIdBatches(ids, async (batch) => {
      const result = await client.from("units").select("id,current_revision_id").in("id", batch).is("retired_at", null);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    }),
    readPages((from, to) => client.from("domains").select("id,path,parent_id").is("retired_at", null).order("path").range(from, to)),
  ]);
  if (units.length !== ids.length) throw new Error("Some selected claims are no longer active. Select again.");
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const ordered = ids.map((id) => {
    const unit = byId.get(id);
    if (!unit) throw new Error("Some selected claims are no longer active. Select again.");
    return unit;
  });
  const [revisions, memberships] = await Promise.all([
    readIdBatches(ordered.map((unit) => unit.current_revision_id), async (batch) => {
      const result = await client.from("revisions").select("id,content").in("id", batch);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    }),
    readIdBatches(ids, async (batch) => {
      const result = await client.from("unit_domains").select("unit_id,domain_id").in("unit_id", batch);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    }),
  ]);
  const content = new Map(revisions.map((revision) => [revision.id, revision.content]));
  const pathById = new Map(domainRows.map((domain) => [domain.id, domain.path]));
  const claims: SelectionClaim[] = ordered.map((unit, index) => ({
    ref: `C${index + 1}`,
    id: unit.id,
    revisionId: unit.current_revision_id,
    domains: memberships.flatMap((row) => row.unit_id === unit.id ? [pathById.get(row.domain_id) ?? ""] : []).filter(Boolean).sort(),
  }));
  return { claims, domainRows, content };
}

export async function suggestSelectionDomain(unitIds: string[]) {
  return toActionResult(async () => {
    await requireUser();
    const { claims, domainRows, content } = await loadSelection(unitIds).catch((error) => { throw asError(error); });
    if (!domainRows.length) throw new Error("Add a domain before generating one from a selection.");
    const db = supabaseRpc(getAdminSupabase());
    const model = await readModelChoice(db);
    const settings = tokenFactoryFromEnv(process.env, model, (call) => db.call("log_ai_call", { p_call: { ...call, role: "domain_decider" } }));
    if (!settings) throw new Error("Configure an AI provider in Settings first.");
    const idByPath = new Map(domainRows.map((domain) => [domain.path, domain.id]));
    const selectedDomainIds = claims.flatMap((claim) => claim.domains.map((path) => idByPath.get(path))).filter((id): id is string => Boolean(id));
    const nearby = nearbyDomainIds(domainRows.map((domain) => ({ id: domain.id, parentId: domain.parent_id })), selectedDomainIds);
    const sample = nearby.length ? await getAdminSupabase().from("unit_domains").select("domain_id,unit_id").in("domain_id", nearby).limit(400) : { data: [], error: null };
    if (sample.error) throw new Error(sample.error.message);
    const selected = new Set(claims.map((claim) => claim.id));
    const exampleUnits = [...new Set((sample.data ?? []).map((row) => row.unit_id).filter((id) => !selected.has(id)))].slice(0, 80);
    const exampleRows = exampleUnits.length ? await readIdBatches(exampleUnits, async (batch) => {
      const result = await getAdminSupabase().from("units").select("id,current_revision_id").in("id", batch).is("retired_at", null);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    }) : [];
    const exampleRevisions = exampleRows.length ? await readIdBatches(exampleRows.map((unit) => unit.current_revision_id), async (batch) => {
      const result = await getAdminSupabase().from("revisions").select("id,content").in("id", batch);
      if (result.error) throw new Error(result.error.message);
      return result.data;
    }) : [];
    const exampleText = new Map(exampleRevisions.map((revision) => [revision.id, revision.content]));
    const textByUnit = new Map(exampleRows.map((unit) => [unit.id, exampleText.get(unit.current_revision_id) ?? ""]));
    const exampleByDomain = new Map<string, string>();
    for (const row of sample.data ?? []) {
      if (exampleByDomain.has(row.domain_id) || selected.has(row.unit_id)) continue;
      const text = textByUnit.get(row.unit_id);
      if (text?.trim()) exampleByDomain.set(row.domain_id, text);
    }
    const evidence = selectionDomainEvidence({
      claims: claims.map((claim) => ({ ref: claim.ref, domains: claim.domains, content: content.get(claim.revisionId) ?? "" })),
      domains: domainRows.map((domain) => ({
        path: domain.path,
        parentPath: domain.path.includes("/") ? domain.path.slice(0, domain.path.lastIndexOf("/")) : null,
        example: exampleByDomain.get(domain.id) ?? null,
      })),
    });
    const packed = JSON.stringify(evidence);
    if (packed.length > 180000) throw new Error("This selection is too large for one review. Select fewer claims. No domains changed.");
    const answer = await chatJson(settings, {
      name: "selection_domain_plan",
      schema: aiSelectionDomainPlanSchema,
      jsonSchema: z.toJSONSchema(aiSelectionDomainPlanSchema),
      messages: [
        { role: "system", content: SELECTION_DOMAIN_RULES },
        { role: "user", content: packed },
      ],
    });
    const plan = resolveSelectionDomainPlan(answer.value, claims, domainRows.map((domain) => domain.path));
    return { plan };
  });
}

export async function applySelectionDomainPlan(plan: SelectionDomainPlan) {
  return toActionResult(async () => {
    await requireUser();
    const parsed = selectionDomainPlanSchema.parse(plan);
    const { claims, domainRows } = await loadSelection(parsed.claims.map((claim) => claim.id)).catch((error) => { throw asError(error); });
    assertSelectionUnchanged(parsed, claims);
    const paths = new Set(domainRows.map((domain) => domain.path));
    const { groups } = resolveSelectionDomainPlan({
      reason: parsed.reason,
      groups: parsed.groups.map((group) => ({
        destinationPath: group.createsDomain ? null : group.destinationPath,
        parentPath: group.parentPath,
        name: group.name,
        claimRefs: group.unitIds.map((id) => claims.find((claim) => claim.id === id)?.ref ?? ""),
        why: group.why,
      })),
    }, claims, [...paths]);
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const actions: DraftAction[] = [];
    const created = new Set<string>();
    for (const group of groups) {
      if (!group.createsDomain || created.has(group.destinationPath)) continue;
      created.add(group.destinationPath);
      actions.push({
        type: "create_domain",
        targetId: null,
        expectedRevisionId: null,
        passageIds: [],
        speechAct: null,
        input: { name: group.name!, path: group.destinationPath, parentPath: group.parentPath },
      });
    }
    for (const group of groups) {
      for (const unitId of group.unitIds) {
        const claim = claimById.get(unitId);
        if (!claim || claimStays(claim.domains, group.destinationPath)) continue;
        actions.push({
          type: "place_claim",
          targetId: unitId,
          expectedRevisionId: claim.revisionId,
          passageIds: [],
          speechAct: null,
          input: { domainPaths: [group.destinationPath], rationale: group.why },
        });
      }
    }
    if (!actions.length) throw new Error("These claims are already filed there. No domains changed.");
    const result = await commitPersonEdit(supabaseRpc(getAdminSupabase()), `Generate domains for ${claims.length} selected claims`, actions);
    return { changeSetId: result.changeSetId, status: result.status, applied: result.applied, total: actions.length };
  });
}
