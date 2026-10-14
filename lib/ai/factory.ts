import "server-only";

import { FakeReconciliationClient } from "./fake/FakeReconciliationClient";
import { TokenFactoryReconciliationClient } from "./tokenFactory";
import type { ReconciliationClient } from "./types";

// Picks the real client only when NEBIUS_API_KEY is set; otherwise the fake, which
// answers the eval fixtures with canned ChangeSets (so the demo runs without a key)
export function getReconciliationClient(env: NodeJS.ProcessEnv = process.env): ReconciliationClient {
  const apiKey = env.NEBIUS_API_KEY;
  if (!apiKey) return new FakeReconciliationClient();
  return new TokenFactoryReconciliationClient({ apiKey, model: env.AI_MODEL });
}
