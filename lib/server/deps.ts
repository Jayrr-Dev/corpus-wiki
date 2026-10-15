import "server-only";

import { loadStageSkills } from "@/lib/ai/skills/server";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { organizeEventHierarchy } from "@/lib/living-page/organizeHierarchy";
import { expandEventKnowledge } from "@/lib/living-page/knowledgeExpansion";
import { createArticlePlanner, type PagePlanner } from "@/lib/living-page/articlePlanner";
import { getReconciliationClient } from "@/lib/ai/factory";
import type { AiCallLogger } from "@/lib/ai/callLog";
import { dedupeAfterEvent } from "@/lib/ingest/dedupe";
import { readChosenModel } from "@/lib/ai/models";
import type { ReconciliationClient } from "@/lib/ai/types";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import { getSectionWriter, type SectionWriter } from "@/lib/living-page";
import { getAdminSupabase } from "@/lib/supabase/admin";

// SERVER DEPENDENCIES: the database port and the two AI clients, built from env
// plus the model picked on /settings (read on every call, so a new pick applies at once).
// Every AI call is logged to public.ai_calls (token usage on /settings).
// Server actions take them from here; tests build their own (pg + fakes).
export type ServerDeps = { db: DbRpc; reconciler: ReconciliationClient; writer: SectionWriter; pagePlanner?: PagePlanner; knowledgeExpander?: (eventId: string) => Promise<void>; hierarchyOrganizer?: (eventId: string) => Promise<void>; deduper?: (eventId: string) => Promise<void> };

export async function getServerDeps(): Promise<ServerDeps> {
  const admin = getAdminSupabase();
  const db = supabaseRpc(admin);
  const [chosenModel, skills] = await Promise.all([readChosenModel(db), loadStageSkills(db)]);
  const logCall: AiCallLogger = (call) => db.call("log_ai_call", { p_call: call });
  const settings = tokenFactoryFromEnv(process.env, chosenModel, logCall);
  if (settings) settings.skills = skills;
  const writer = getSectionWriter(process.env, chosenModel, skills, logCall);
  return {
    db,
    deduper: settings ? (eventId) => dedupeAfterEvent({ db, client: admin, settings }, eventId) : undefined,
    hierarchyOrganizer: (eventId) => organizeEventHierarchy(db, eventId),
    knowledgeExpander: settings ? (eventId) => expandEventKnowledge({ settings, client: admin, db, writer }, eventId) : undefined,
    pagePlanner: settings ? createArticlePlanner(settings, admin) : undefined,
    reconciler: getReconciliationClient(process.env, chosenModel, skills, logCall),
    writer,
  };
}
