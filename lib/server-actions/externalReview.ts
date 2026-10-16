"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { getServerDeps } from "@/lib/server/deps";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { readModelChoice } from "@/lib/ai/models";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import { approveExternalSearch, approveExternalSource, type ReviewRecorder } from "@/lib/knowledge/externalApproval";
import { externalProjectContext, externalReviewRecorder } from "@/lib/knowledge/externalReviewStore";
import { loadArticleKnowledge } from "@/lib/living-page/articlePlanner";
import { archiveSource, restoreSource } from "@/lib/ingest/sourceLifecycle";
import { type ActionResult, toActionResult } from "./result";
import { typeIsOrganization } from "@/lib/knowledge/entityTypes";

export async function reviewSavedExternalSources(entityId: string): Promise<ActionResult<{ approved: number; archived: number; failed: number; skipped: number }>> {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(entityId);
    const client = getAdminSupabase();
    const { db } = await getServerDeps();
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
    if (!settings) throw new Error("Configure an AI provider in Settings before reviewing sources.");
    settings.roleInstructions = await loadRoleInstructions(db);
    const knowledge = await loadArticleKnowledge(client, entityId);
    if (!typeIsOrganization(knowledge.entity.type) && knowledge.entity.type !== "project") throw new Error("Choose a company, organization, or project as the review context.");
    const { data: sources, error } = await client.from("sources").select("id,title,url,archived_at").eq("origin", "external").order("created_at").limit(20);
    if (error) throw new Error(error.message);
    const roots = await client.from("domains").select("context_entity_id").is("parent_id", null).is("retired_at", null).not("context_entity_id", "is", null);
    if (roots.error) throw new Error(roots.error.message);
    const rootCount = new Set((roots.data ?? []).map((root) => root.context_entity_id)).size;
    const priorReviews = await client.from("external_source_reviews").select("source_id,context,outcome,stage").not("source_id", "is", null);
    if (priorReviews.error) throw new Error(priorReviews.error.message);
    const result = { approved: 0, archived: 0, failed: 0, skipped: 0 };
    for (const source of sources ?? []) {
      try {
        if (!source.url) { result.failed++; continue; }
        const earlier = (priorReviews.data ?? []).filter((review) => review.source_id === source.id);
        // Recheck archives rejected by this review flow, but leave manually archived
        // sources without a project review alone.
        if (source.archived_at && !earlier.some((review) => review.outcome === "rejected" && (review.context as { organization?: string }).organization === knowledge.entity.name)) { result.skipped++; continue; }
        const owners = earlier.filter((review) => review.stage === "source" && review.outcome === "approved").map((review) => (review.context as { organization?: string }).organization).filter(Boolean);
        if (owners.some((owner) => owner !== knowledge.entity.name) || (!owners.length && rootCount !== 1)) { result.skipped++; continue; }
        // Do not call the source redundant merely because its own claims are saved.
        const ownLinks = await client.from("source_units").select("unit_id").eq("source_id", source.id);
        if (ownLinks.error) throw new Error(ownLinks.error.message);
        const ownIds = new Set((ownLinks.data ?? []).flatMap((link) => link.unit_id ? [link.unit_id] : []));
        const others = ownIds.size ? await client.from("source_units").select("unit_id").in("unit_id", [...ownIds]).neq("source_id", source.id) : { data: [], error: null };
        if (others.error) throw new Error(others.error.message);
        const shared = new Set((others.data ?? []).map((link) => link.unit_id));
        const candidates = knowledge.units.filter((unit) => !ownIds.has(unit.unitId) || shared.has(unit.unitId));
        const context = await externalProjectContext(client, { title: knowledge.entity.name, entity_id: entityId }, source.title, candidates);
        // No established project facts means no reliable basis for a retrospective decision.
        if (!context.projectFacts.length) throw new Error("No internally sourced project context is available.");
        const store = externalReviewRecorder(client, null, null);
        let reviewFailed = false;

        let finalReviewId: string | undefined;
        const record: ReviewRecorder = async (review) => {

          if (review.outcome === "error") reviewFailed = true;
          const id = await store({ ...review, url: source.url, sourceTitle: source.title });
          const { error } = await client.from("external_source_reviews").update({ source_id: source.id }).eq("id", id);
          if (error) throw new Error(error.message);
          finalReviewId = id;
          return id;
        };
        const research = await approveExternalSearch(settings, context, "Review whether this previously imported source is actually needed by the original project. Prior inclusion is not proof of relevance.", record);
        let approved = false;
        if (research) {
          const { data: passages, error: passageError } = await client.from("passages").select("text").eq("source_id", source.id).order("position");
          if (passageError) throw new Error(passageError.message);
          const text = (passages ?? []).map((passage) => passage.text).join("\n\n").slice(0, 8000);
          approved = Boolean(await approveExternalSource(settings, context, research, { title: source.title, url: source.url, text }, record));
        }
        if (reviewFailed) { result.failed++; continue; }
        if (approved) { if (source.archived_at) await restoreSource(source.id, finalReviewId); result.approved++; }
        else { if (!source.archived_at) await archiveSource(source.id, finalReviewId); result.archived++; }
      } catch (error) {
        console.error(`Review of external source ${source.id} failed:`, error);
        result.failed++;
      }
    }
    return result;
  });
}
