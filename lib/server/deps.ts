import "server-only";
import { topicPlacerFor } from "@/lib/ingest/placeTopicsServer";
import { generateGlossary } from "@/lib/glossary/generate";
import { embedMissingGlossary } from "@/lib/glossary/embeddingStore";

import { loadStageSkills } from "@/lib/ai/skills/server";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { organizeEventHierarchy } from "@/lib/living-page/organizeHierarchy";
import { expandEventKnowledge } from "@/lib/living-page/knowledgeExpansion";
import { orchestrateEventArticles } from "@/lib/living-page/articleOrchestrator";
import { createArticlePlanner, type PagePlanner } from "@/lib/living-page/articlePlanner";
import { getReconciliationClient } from "@/lib/ai/factory";
import type { AiCallLogger } from "@/lib/ai/callLog";
import { dedupeAfterEvent } from "@/lib/ingest/dedupe";
import { duplicateGuardFor } from "@/lib/ingest/duplicateGuardServer";
import { embedderFromEnv } from "@/lib/ai/embeddings";
import { embedMissingUnits } from "@/lib/knowledge/embeddingStore";
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
import { reviewRebuiltSections } from "@/lib/living-page/runPageReview";
import { requireContextStorage } from "./contextReadiness";

// SERVER DEPENDENCIES: the database port and the two AI clients, built from env
// plus the model picked on /settings (read on every call, so a new pick applies at once).
// Every AI call is logged to public.ai_calls (token usage on /settings).
// Server actions take them from here; tests build their own (pg + fakes).
export type ServerDeps = { db: DbRpc; reconciler: ReconciliationClient; writer: SectionWriter; glossaryGenerator?: () => Promise<void>; pagePlanner?: PagePlanner; articleOrchestrator?: (eventId: string) => Promise<unknown>; knowledgeExpander?: (eventId: string) => Promise<void>; hierarchyOrganizer?: (eventId: string) => Promise<void>; deduper?: (eventId: string) => Promise<void>; topicPlacer?: (eventId: string) => Promise<void>; entityDescriber?: (eventId: string) => Promise<void>; entityTidier?: (eventId: string) => Promise<void>; profileWriter?: (eventId: string) => Promise<void>; duplicateGuard?: PipelineDeps["duplicateGuard"]; claimEmbedder?: () => Promise<void>; imageDescriber: ImageDescriber | null; videoReader: VideoReader | null };

export async function getServerDeps(): Promise<ServerDeps> {
  const admin = getAdminSupabase();
  await requireContextStorage(admin);
  const db = supabaseRpc(admin);
  const [chosenModel, skills] = await Promise.all([readModelChoice(db), loadStageSkills(db)]);
  const logCall: AiCallLogger = (call) => db.call("log_ai_call", { p_call: call });
  const settings = tokenFactoryFromEnv(process.env, chosenModel, logCall);
  if (settings) settings.skills = skills;
  const writer = getSectionWriter(process.env, chosenModel, skills, logCall);
  // Section builds tell open pages what they are doing and stream their draft
  writer.progress = broadcastSectionProgress(admin);
  const embedder = embedderFromEnv(process.env, logCall);
  if (settings) writer.reviewSections = (sectionIds) => reviewRebuiltSections(db, settings, sectionIds, embedder);
  return {
    db,
    glossaryGenerator: settings ? async () => {
      await generateGlossary(admin, settings);
      if (embedder) await embedMissingGlossary(db, embedder);
    } : undefined,
    claimEmbedder: embedder ? async () => void (await embedMissingUnits(db, embedder)) : undefined,
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
    articleOrchestrator: settings ? (eventId) => orchestrateEventArticles({ settings, client: admin, db, embedder }, eventId) : undefined,
    reconciler: getReconciliationClient(process.env, chosenModel, skills, logCall),
    videoReader: videoReaderFrom(settings),
    writer,
  };
}
