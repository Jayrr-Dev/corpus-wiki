import "server-only";

import { reviewSummarySchema, formatReviewSummary, REVIEW_SUMMARY_INSTRUCTIONS } from "@/lib/domains/reviewSummary";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { chatJson, tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readChosenModel } from "@/lib/ai/models";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import { FIXED_ROLES } from "@/lib/ai/roles";
import { domainReviewSchema, validateDomainReview, type DomainReviewSnapshot } from "@/lib/domains/review";
import { toActionResult } from "@/lib/server-actions/result";

export async function runDomainReview(progress: (detail: string) => void = () => {}) {
  return toActionResult(async () => {
    await requireUser();
    progress("Loading domain hierarchy and saved evidence…");
    const db = supabaseRpc(getAdminSupabase());
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), (call) => db.call("log_ai_call", { p_call: { ...call, role: "domain_steward" } }));
    if (!settings) throw new Error("Configure an AI provider in Settings before reviewing domains.");
    const snapshot = await db.call<DomainReviewSnapshot>("domain_review_snapshot");
    const instructions = (await loadRoleInstructions(db)).find((r) => r.role === "domain_steward")?.instructions ?? FIXED_ROLES.find((r) => r.id === "domain_steward")!.instructions;
    // The RPC reads all rows atomically, avoiding silent truncation at the API row limit.
    const evidence = JSON.stringify(snapshot);
    if (evidence.length > 180000) throw new Error("The domain review is too large for one complete review. No changes were made.");
    progress(`Reviewing ${snapshot.domains.length} domains against saved evidence…`);
    let receiving = false;
    const schema = domainReviewSchema.extend({ summary: reviewSummarySchema });
    const answer = await chatJson(settings, { name: "domain_structure_review", schema,
      jsonSchema: z.toJSONSchema(schema),
      onStream: ({ content }) => { if (content && !receiving) { receiving = true; progress("Writing the findings and recommended next steps…"); } },
      messages: [{ role: "system", content: instructions + "\n" + REVIEW_SUMMARY_INSTRUCTIONS }, { role: "user", content: evidence }] });
    answer.value.reason = formatReviewSummary(answer.value.summary);
    progress("Checking proposed changes against domain safeguards…");
    validateDomainReview(answer.value, snapshot);
    progress("Saving the decision and any exceptions…");
    const result = await db.call<{ changeSetId: string; exceptions: number }>("record_domain_review", {
      p_snapshot: snapshot, p_review: answer.value,
      p_trace: { modelVersion: answer.model, promptVersion: "domain-steward-v2", tokensIn: answer.tokensIn, tokensOut: answer.tokensOut },
    });
    return { ...result, reason: answer.value.reason };
  });
}
