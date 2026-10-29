import "server-only";
import { topicPlacerFor } from "@/lib/ingest/placeTopicsServer";
import { refreshOrganizationOverviews } from "@/lib/living-page/refreshOrganizationOverviews";
import { generateGlossary } from "@/lib/glossary/generate";
import { embedMissingGlossary } from "@/lib/glossary/embeddingStore";

import { loadStageSkills } from "@/lib/ai/skills/server";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { organizeEventHierarchy } from "@/lib/living-page/organizeHierarchy";
import { expandEventKnowledge } from "@/lib/living-page/knowledgeExpansion";
import { orchestrateEventArticles } from "@/lib/living-page/articleOrchestrator";
import { maintainPageTree } from "@/lib/curator/maintainPageTree";
import { createArticlePlanner, type PagePlanner } from "@/lib/living-page/articlePlanner";
import { getReconciliationClient } from "@/lib/ai/factory";
import type { AiCallLogger } from "@/lib/ai/callLog";
import { dedupeAfterEvent } from "@/lib/ingest/dedupe";
import { duplicateGuardFor } from "@/lib/ingest/duplicateGuardServer";
import { embedderFromEnv } from "@/lib/ai/embeddings";
import { embedMissingPassages, embedMissingUnits } from "@/lib/knowledge/embeddingStore";
import type { ImageDescriber } from "@/lib/ingest/describeMedia";
import { imageDescriberFrom } from "@/lib/ingest/describeMediaServer";
import type { VideoReader } from "@/lib/ingest/describeVideo";
import { videoReaderFrom } from "@/lib/ingest/describeVideoServer";
import { describeEventEntities } from "@/lib/knowledge/entityDescriptions";
import { cleanUpEntities } from "@/lib/knowledge/entityCleanup";
import { profileEventEntities } from "@/lib/knowledge/entityProfiles";
import { readModelChoice } from "@/lib/ai/models";
import type { ReconciliationClient } from "@/lib/ai/types";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import { getSectionWriter, type SectionWriter } from "@/lib/living-page";
import type { PipelineDeps } from "@/lib/ingest/pipeline";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { broadcastSectionProgress } from "./sectionBroadcast";
import { reviewRebuiltSections, verifyEventArticleReviews } from "@/lib/living-page/runPageReview";
import { requireContextStorage } from "./contextReadiness";
import { serverUsageGate } from "@/lib/billing/server";

// SERVER DEPENDENCIES: the database port and the two AI clients, built from env
// plus the model picked on /settings (read on every call, so a new pick applies at once).
// Every AI call is logged to public.ai_calls (token usage on /settings).
// Server actions take them from here; tests build their own (pg + fakes).
export type ServerDeps = { refreshAppliedOverviews?: (eventId: string, pageIds: string[]) => Promise<import("@/lib/living-page/refreshOrganizationOverviews").OverviewOutcome[]>; db: DbRpc; reconciler: ReconciliationClient; writer: SectionWriter; glossaryGenerator?: () => Promise<void>; pagePlanner?: PagePlanner; articleOrchestrator?: (eventId: string, scope?: string, unitIds?: string[]) => Promise<import("@/lib/living-page/articleOrchestrator").OrchestratorResult>; knowledgeExpander?: (eventId: string) => Promise<void>; hierarchyOrganizer?: (eventId: string) => Promise<void>; deduper?: (eventId: string) => Promise<void>; topicPlacer?: (eventId: string) => Promise<void>; entityDescriber?: (eventId: string) => Promise<void>; entityTidier?: (eventId: string) => Promise<void>; profileWriter?: (eventId: string) => Promise<void>; duplicateGuard?: PipelineDeps["duplicateGuard"]; claimEmbedder?: () => Promise<void>; articleVerifier?: (eventId: string) => Promise<void>; pageMaintainer?: (eventId: string | null, options?: { curate?: boolean; dispatches?: import("@/lib/curator/plan").Dispatch[] }) => Promise<unknown>; imageDescriber: ImageDescriber | null; videoReader: VideoReader | null };

export async function getServerDeps(): Promise<ServerDeps> {
  const { startComposerWorker } = await import("@/lib/composer/worker");
  startComposerWorker();
  const admin = getAdminSupabase();
  await requireContextStorage(admin);
  const db = supabaseRpc(admin);
  const [chosenModel, skills] = await Promise.all([readModelChoice(db), loadStageSkills(db)]);
  const logCall: AiCallLogger = (call) => db.call("log_ai_call", { p_call: call });
  const settings = tokenFactoryFromEnv(process.env, chosenModel, logCall);
  if (settings) {
    settings.skills = skills;
    // Meters credits behind the billing flag; blocks only while the monetization switch is on
    settings.usageGate = serverUsageGate(db);
  }
  const writer = getSectionWriter(process.env, chosenModel, skills, logCall);
  // Section builds tell open pages what they are doing and stream their draft
  writer.progress = broadcastSectionProgress(admin);
  const embedder = embedderFromEnv(process.env, logCall);
  if (settings) writer.reviewSections = (sectionIds, scope) => reviewRebuiltSections(db, settings, sectionIds, embedder, scope);
  return {
    refreshAppliedOverviews: settings ? (eventId: string, pageIds: string[]) => refreshOrganizationOverviews({ settings, client: admin, db, writer }, eventId, { pageIds }) : undefined,
    db,
    articleVerifier: settings ? (eventId) => verifyEventArticleReviews(db, settings, eventId, embedder) : undefined,
    glossaryGenerator: settings ? async () => {
      await generateGlossary(admin, settings);
      if (embedder) await embedMissingGlossary(db, embedder);
    } : undefined,
    // New claims first (duplicate checks wait on them), then any source passages not yet embedded
    claimEmbedder: embedder ? async () => {
      await embedMissingUnits(db, embedder);
      await embedMissingPassages(db, embedder);
    } : undefined,
    deduper: settings ? (eventId) => dedupeAfterEvent({ db, client: admin, settings, embedder }, eventId) : undefined,
    topicPlacer: settings ? topicPlacerFor(db, settings) : undefined,
    duplicateGuard: settings ? duplicateGuardFor(db, settings, embedder) : undefined,
    entityDescriber: settings ? (eventId) => describeEventEntities({ client: admin, settings }, eventId) : undefined,
    entityTidier: settings ? async (eventId) => void (await cleanUpEntities(db, settings, eventId)) : undefined,
    profileWriter: settings ? (eventId) => profileEventEntities({ client: admin, settings }, eventId) : undefined,
    hierarchyOrganizer: (eventId) => organizeEventHierarchy(db, admin, eventId),
    imageDescriber: imageDescriberFrom(settings),
    knowledgeExpander: settings ? (eventId) => expandEventKnowledge({ settings, client: admin, db, writer }, eventId) : undefined,
    pagePlanner: settings ? createArticlePlanner(settings, admin) : undefined,
    articleOrchestrator: settings ? (eventId, scope, unitIds) => orchestrateEventArticles({ settings, client: admin, db, embedder }, eventId, scope, unitIds) : undefined,
    pageMaintainer: settings ? (eventId, options) => maintainPageTree({ settings, client: admin, db, writer, embedder }, eventId, options) : undefined,
    reconciler: getReconciliationClient(process.env, chosenModel, skills, logCall),
    videoReader: videoReaderFrom(settings),
    writer,
  };
}
