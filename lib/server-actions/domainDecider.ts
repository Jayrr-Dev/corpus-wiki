"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { toActionResult } from "./result";
import { embedderFromEnv } from "@/lib/ai/embeddings";
import { embedMissingUnits, savedVectors } from "@/lib/knowledge/embeddingStore";
import { chatJson, tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import { DOMAIN_DECIDER_INSTRUCTIONS, validateDecisionCoverage, validatePlacementSequence, type DecisionSnapshot, type DomainConnection } from "@/lib/domains/decider";
import { z } from "zod";
import { domainReviewKey, focusedReview, validateFocusedReview } from "@/lib/domains/focusedReview";
import { organizationEvidence, organizationPlanSchema, organizationCritiqueSchema, simulateOrganization, validateAlternativeCoverage, validateCritique, ORGANIZATION_METHOD, ORGANIZATION_CRITIC } from "@/lib/domains/organizationEvidence";
import { residualParentEvidence, validateParentGroups } from "@/lib/domains/organizationEvidence";

const gradeHistorySchema = z.array(z.object({
  attempt: z.number(),
  review: z.object({ grouping: z.enum(["pass", "needs_work"]), placement: z.enum(["pass", "needs_work"]), simplicity: z.enum(["pass", "needs_work"]), reason: z.string(),
    parentGroups: z.array(z.object({path:z.string(),groups:z.array(z.object({subject:z.string(),claims:z.array(z.string()),reason:z.string()}))})).optional(),
  }).optional(),
})).catch([]);

export async function domainUpdateHistory() {
  return toActionResult(async () => {
    await requireUser();
    const { data, error } = await getAdminSupabase().from("change_sets")
      .select("id,status,summary").eq("actor_attribution->proposedBy->>role", "domain_decider")
      .order("created_at", { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    const updates = data ?? [];
    const applied = updates.length ? await getAdminSupabase().from("actions").select("id,change_set_id,qualityIterations:input->qualityIterations").in("change_set_id", updates.map(c => c.id)).eq("outcome", "applied") : { data: [], error: null };
    if (applied.error) throw new Error(applied.error.message);
    const undoable = new Set((applied.data ?? []).map(a => a.change_set_id));
    const reviewed = applied.data?.length ? await getAdminSupabase().from("exceptions").select("action_id,note").in("action_id", applied.data.map(a => a.id)).eq("status", "accepted") : { data: [], error: null };
    if (reviewed.error) throw new Error(reviewed.error.message);
    return { updates: updates.map(change => ({ ...change, undoable: undoable.has(change.id), qualityIterations: gradeHistorySchema.parse(applied.data?.find(a => a.change_set_id === change.id)?.qualityIterations), reviewNote: reviewed.data?.find(e => applied.data?.some(a => a.id === e.action_id && a.change_set_id === change.id))?.note ?? null })) };
  });
}

export async function undoDomainUpdate(changeSetId: string) {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(changeSetId);
    const client = getAdminSupabase();
    const { data, error } = await client.from("change_sets").select("id")
      .eq("id", changeSetId).eq("actor_attribution->proposedBy->>role", "domain_decider").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Domain update not found.");
    // Structural updates do not rewrite article text; restoring the audited snapshot is sufficient.
    await supabaseRpc(client).call("revert_change_set", { p_change_set_id: changeSetId });
    return {};
  });
}

export async function updateDomains(guidance: string = "", graphOptions: { threshold: number; show: boolean } = { threshold: 0.3, show: true }, reviewed: string[] = [], previewOnly: boolean = false, targetPath: string = "") {
  return toActionResult(async () => {
    await requireUser();
    targetPath = z.string().trim().max(2000).parse(targetPath);
    previewOnly = z.boolean().parse(previewOnly);
    reviewed = z.array(z.string().max(4096)).max(600).parse(reviewed);
    guidance = z.string().trim().max(2000).parse(guidance);
    graphOptions = z.object({ threshold: z.number().min(0).max(1), show: z.boolean() }).parse(graphOptions);
    const db = supabaseRpc(getAdminSupabase());
    const logger = async (call: Parameters<NonNullable<Parameters<typeof tokenFactoryFromEnv>[2]>>[0]) => { await db.call("log_ai_call", { p_call: { ...call, role: "domain_decider" } }); };
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), logger);
    const embedder = embedderFromEnv(process.env, logger);
    if (!settings || !embedder) throw new Error("Configure an AI provider and embeddings in Settings before updating domains.");
    await embedMissingUnits(db, embedder);
    const snapshot = await db.call<DecisionSnapshot>("domain_review_snapshot");
    const revisions = snapshot.claims.filter(c => !c.retiredAt).map(c => c.revisionId);
    const vectors = new Map<string, number[]>();
    for (let i = 0; i < revisions.length; i += 256) {
      for (const [id, vector] of await savedVectors(db, embedder.model, revisions.slice(i, i + 256))) vectors.set(id, vector);
    }
    const connections = await db.call<DomainConnection[]>("domain_decider_connections");
    // Discovery must not depend on the current visual filters or existing-domain similarity bonuses.
    const scope = focusedReview(snapshot, vectors, connections, reviewed, targetPath);
    if (!scope) {
      const limited = snapshot.domains.filter(d => !d.retired_at && reviewed.filter(key => key.startsWith(d.path + "|")).length >= 3 && !reviewed.includes(domainReviewKey(snapshot, connections, d.path)));
      return { reason: limited.length ? `Follow-up needed after the repeat limit: ${limited.map(d => d.path).join(", ")}. Run Update Domains again to continue.` : "All candidate domains reviewed.", exceptions: 0, changes: 0, changeSetId: null, domain: null, reviewKey: null, directClaims: 0, remaining: 0 };
    }
    if (previewOnly) return { reason: "Ready to review", exceptions: 0, changes: 0, changeSetId: null, domain: scope.target.path, reviewKey: scope.reviewKey, directClaims: scope.target.count, remaining: scope.remaining };
    const alternatives = organizationEvidence(snapshot, vectors, connections, [...scope.writable]);
    const context = { ...scope.context, clusters: undefined, claims: scope.context.clusters.flatMap(c => c.claims), partitionAlternatives: alternatives };
    const evidence = JSON.stringify(context);
    if (evidence.length > 300000) throw new Error("This domain needs a smaller review scope. No domains changed.");
    const instructions = (await loadRoleInstructions(db)).find(r => r.role === "domain_decider")?.instructions ?? DOMAIN_DECIDER_INSTRUCTIONS;
    let feedback = "";
    let answer: Awaited<ReturnType<typeof propose>> | undefined;
    let critique: z.infer<typeof organizationCritiqueSchema> | undefined;
    let simulation: ReturnType<typeof simulateOrganization> | undefined;
    let tokensIn: number | null = 0, tokensOut: number | null = 0;
    let attempts = 0;
    const iterations: { attempt: number; review?: z.infer<typeof organizationCritiqueSchema>; feedback?: string }[] = [];
    async function propose() {
      return chatJson(settings!, { name: "domain_decision", schema: organizationPlanSchema, jsonSchema: z.toJSONSchema(organizationPlanSchema), onStream: () => {},
        messages: [{ role: "system", content: instructions + "\n" + ORGANIZATION_METHOD + "\nOnly change the target domain and descendants. Neighbor claims are read-only context. Assess every mustReview path and decide every candidate ref. Compare every supplied partition alternative exactly once. Operations execute in order. Newly created paths use destinationPath plus name." },
          { role: "user", content: evidence },
          ...(guidance ? [{ role: "user" as const, content: `The person's guidance: ${guidance}` }] : []),
          ...(feedback ? [{ role: "user" as const, content: feedback }] : [])] });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      attempts = attempt + 1;
      const iteration: (typeof iterations)[number] = { attempt: attempts };
      iterations.push(iteration);
      answer = await propose();
      tokensIn = tokensIn === null || answer.tokensIn === null ? null : tokensIn + answer.tokensIn;
      tokensOut = tokensOut === null || answer.tokensOut === null ? null : tokensOut + answer.tokensOut;
      try {
        validateFocusedReview(answer.value, scope);
        validateDecisionCoverage(answer.value, context);
        validatePlacementSequence(answer.value, snapshot);
        validateAlternativeCoverage(answer.value, alternatives);
        simulation = simulateOrganization(snapshot, answer.value, [...scope.writable]);
        const residualParents = residualParentEvidence(snapshot, vectors, connections, simulation);
        const assessed = await chatJson(settings, { name: "domain_decision", schema: organizationCritiqueSchema, jsonSchema: z.toJSONSchema(organizationCritiqueSchema), onStream: () => {},
          messages: [{ role: "system", content: ORGANIZATION_CRITIC }, { role: "user", content: evidence },
            ...(guidance ? [{role:"user" as const, content:`The person's guidance: ${guidance}`}] : []),
            { role: "user", content: JSON.stringify({ proposal: answer.value, simulation, residualParents }) }] });
        tokensIn = tokensIn === null || assessed.tokensIn === null ? null : tokensIn + assessed.tokensIn;
        tokensOut = tokensOut === null || assessed.tokensOut === null ? null : tokensOut + assessed.tokensOut;
        critique = assessed.value;
        iteration.review = critique;
        validateParentGroups(critique, residualParents);
        validateCritique(critique, answer.value.operations.length, simulation.after.map(d=>d.path));
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid organization";
        iteration.feedback = message;
        if (attempt === 2) throw new Error("No domain changes applied: " + message);
        feedback = "Revise the complete proposal using all prior validation/quality feedback. Preserve fixes already made: " + JSON.stringify(iterations) + "\nPrevious proposal: " + JSON.stringify(answer.value);
      }
    }
    if (!answer || !critique || !simulation) throw new Error("Domain review did not complete. No changes applied.");
    const quality = `AI review: grouping ${critique.grouping}, placement ${critique.placement}, simplicity ${critique.simplicity}. ${attempts} proposal attempt(s).`;
    if (!answer.value.operations.length) return { domain: scope.target.path, reviewKey: scope.reviewKey, directClaims: scope.target.count, remaining: scope.remaining - 1, reason: answer.value.reason + " " + quality, exceptions: 0, changes: 0, changeSetId: null };
    const live = snapshot.claims.filter(c => !c.retiredAt);
    const review = { ...answer.value, operations: answer.value.operations.map(op => ({ ...op, claimIds: op.claimIds.map(ref => {
      const claim = live[Number(ref.slice(1)) - 1];
      if (!claim) throw new Error("Domain Decider returned an unknown claim reference. No domains changed.");
      return claim.id;
    }) })) };
    const result = await db.call<{ changeSetId: string; exceptions: number; status: string; rejected: number }>("record_domain_decision", {
      p_snapshot: snapshot, p_review: { ...review, reviewGuidance: guidance, targetPath: scope.target.path, connectionSnapshot: connections, qualityReview: critique, qualityIterations: iterations, organizationComparison: simulation, proposalAttempts: attempts, clusteringMethod: "independent-average-linkage-v1" },
      p_trace: { modelVersion: answer.model, promptVersion: "domain-decider-residual-parent-audit-v7", tokensIn, tokensOut },
    });
    if (result.rejected || result.status === "rejected") throw new Error("Domain changes were rejected because the saved knowledge changed. Run Update Domains again.");
    return { domain: scope.target.path, reviewKey: scope.reviewKey, directClaims: scope.target.count, remaining: scope.remaining - 1, reason: answer.value.reason + " " + quality, exceptions: result.exceptions, changes: result.exceptions ? 0 : answer.value.operations.length, changeSetId: result.changeSetId };
  });
}
