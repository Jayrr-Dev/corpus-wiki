import "server-only";

import { tokenFactoryFromEnv } from "./chat";
import { FakeReconciliationClient } from "./fake/FakeReconciliationClient";
import { TokenFactoryReconciliationClient } from "./tokenFactory/client";
import type { ReconciliationClient } from "./types";

// Picks the real client only when NEBIUS_API_KEY is set; otherwise the fake, which
// answers the eval fixtures with canned ChangeSets (so the demo runs without a key)
export function getReconciliationClient(env: NodeJS.ProcessEnv = process.env, chosenModel: string | null = null): ReconciliationClient {
  const settings = tokenFactoryFromEnv(env, chosenModel);
  return settings ? new TokenFactoryReconciliationClient(settings) : new FakeReconciliationClient();
}
