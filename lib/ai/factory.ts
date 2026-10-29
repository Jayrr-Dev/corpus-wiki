import "server-only";

import type { AiCallLogger } from "./callLog";
import { type ModelChoice, tokenFactoryFromEnv } from "./chat";
import { embedderFromEnv } from "./embeddings";
import { FakeReconciliationClient } from "./fake/FakeReconciliationClient";
import { TokenFactoryReconciliationClient } from "./tokenFactory/client";
import { dbNeighborhoodStore } from "./tokenFactory/neighborhood";
import { dbExtractionCache, SplitReconciliationClient } from "./tokenFactory/splitClient";
import type { StageSkills } from "./skills/types";
import type { ReconciliationClient } from "./types";
import { uploadExecution } from "@/lib/ingest/workflowContext";

// Picks the real client only when NEBIUS_API_KEY is set; otherwise the fake, which
// answers the eval fixtures with canned ChangeSets (so the demo runs without a key).
// RECONCILE_CLIENT=split picks the two-stage client (issue #45); it reads the store
// through the running upload's database, and without one (a web page, a script)
// it compares drafts with the input's claims by shared entities and words only.
export function getReconciliationClient(
  env: NodeJS.ProcessEnv = process.env,
  chosenModel: string | null | ModelChoice = null,
  skills?: StageSkills,
  logCall?: AiCallLogger,
): ReconciliationClient {
  const settings = tokenFactoryFromEnv(env, chosenModel, logCall);
  if (!settings) return new FakeReconciliationClient();
  if (env.RECONCILE_CLIENT !== "split") return new TokenFactoryReconciliationClient({ ...settings, skills });
  const embedder = embedderFromEnv(env, logCall);
  return new SplitReconciliationClient({ ...settings, skills }, () => {
    const db = uploadExecution.getStore()?.db;
    return db ? { store: dbNeighborhoodStore(db, embedder), cache: dbExtractionCache(db) } : null;
  });
}
