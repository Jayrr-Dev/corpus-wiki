import "server-only";

import { readMonetizationEnabled } from "@/lib/ai/models";
import type { DbRpc } from "@/lib/db/rpc";
import { isFeatureEnabled } from "@/lib/flags/server";
import { createUsageGate, type UsageGate, type UsageGateMode, usageGateMode } from "./gate";

// BILLING ON THE SERVER: the gate's mode comes from the billing flag (off: not
// metered) and the workspace monetization switch (off: metered, never blocked)
export async function readUsageGateMode(db: DbRpc): Promise<UsageGateMode> {
  if (!(await isFeatureEnabled("billing"))) return "off";
  const monetization = await readMonetizationEnabled(db).catch((error: unknown) => {
    console.error("The monetization switch could not be read; limits are not enforced.", error);
    return false;
  });
  return usageGateMode(true, monetization);
}

// The usage gate the app's AI calls run behind (lib/server/deps.ts)
export function serverUsageGate(db: DbRpc): UsageGate {
  return createUsageGate({ db, mode: () => readUsageGateMode(db) });
}
