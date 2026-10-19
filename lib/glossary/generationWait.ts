import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { assertActiveUpload, uploadExecution } from "@/lib/ingest/workflowContext";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { retryGlossaryOperation } from "./retry";

// An upload cannot finish its dictionary stage merely because another worker
// owns generation. Wait for publication without stealing or clearing its lease.
// true asks the caller to reload changed knowledge or reclaim an expired job.
export async function waitForGlossaryPublisher(client: AdminSupabase, inputHash: string): Promise<boolean> {
  for (;;) {
    await assertActiveUpload();
    const state = await retryGlossaryOperation(async () => {
      const { data, error } = await client.from("glossary_state").select("status,input_hash,lease_until").eq("id", true).single();
      if (error) throw Object.assign(new Error(error.message), error);
      if (!data) throw new Error("Dictionary publication state is unavailable. Resume to retry.");
      return data;
    });
    if (state.status === "ready") return state.input_hash !== inputHash;
    if (!state.lease_until || Date.parse(state.lease_until) <= Date.now()) return true;
    await delay(10_000, undefined, { signal: uploadExecution.getStore()?.signal });
  }
}
