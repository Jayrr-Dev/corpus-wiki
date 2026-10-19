import "server-only";
import { supabaseRpc } from "@/lib/db/rpc";
import { forEachWorkerSpace } from "@/lib/spaces/workers";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { processSuggestionWork } from "./run";

// Works through the current space's suggestion jobs (accepted suggestions first)
export async function drainSuggestionWork(limit = 20): Promise<number> {
  const admin = getAdminSupabase();
  const db = supabaseRpc(admin);
  // The section writer is only built when an accepted suggestion needs text written
  const writer = async () => (await import("@/lib/server/deps")).getServerDeps().then((deps) => deps.writer);
  let worked = 0;
  while (worked < limit && await processSuggestionWork(db, admin, writer)) worked++;
  return worked;
}

// Every 15 seconds: resumes runs and accepts whose worker stopped, in every space.
// The Run and Accept buttons also start the work at once (lib/server-actions/suggestions.ts).
const workerKey = Symbol.for("second-brain.article-suggestions");
export function startSuggestionWorker() {
  if (process.env.SUGGESTIONS_WORKER_ENABLED === "false" || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return;
  const state = globalThis as typeof globalThis & { [workerKey]?: ReturnType<typeof setInterval> };
  if (state[workerKey]) return;
  let busy = false;
  state[workerKey] = setInterval(() => {
    if (busy) return;
    busy = true;
    void forEachWorkerSpace(() => drainSuggestionWork())
      .catch((error) => console.warn("Article suggestions worker failed:", error instanceof Error ? error.message : String(error)))
      .finally(() => { busy = false; });
  }, 15_000);
  state[workerKey].unref?.();
}
