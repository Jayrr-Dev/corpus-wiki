import "server-only";
import { supabaseRpc } from "@/lib/db/rpc";
import { forEachWorkerSpace } from "@/lib/spaces/workers";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { processSuggestionWork } from "./run";

// How many accepted suggestions to apply at once. Merges into the same article still wait their turn.
const APPLY_AT_ONCE = 3;

// Works through the current space's suggestion jobs (merges first, then new articles, then a run)
export async function drainSuggestionWork(limit = 60): Promise<number> {
  const admin = getAdminSupabase();
  const db = supabaseRpc(admin);
  // The section writer is only built when an accepted suggestion needs text written
  const writer = async () => (await import("@/lib/server/deps")).getServerDeps().then((deps) => deps.writer);
  let worked = 0;
  let idle = false;
  async function next() {
    while (!idle && worked < limit) {
      const found = await processSuggestionWork(db, admin, writer);
      if (!found) { idle = true; return; }
      worked += 1;
    }
  }
  await Promise.all(Array.from({ length: APPLY_AT_ONCE }, () => next()));
  return worked;
}

// Every 15 seconds: resumes runs and accepts whose worker stopped, in every space.
// The Run and Accept buttons also start the work at once (lib/server-actions/suggestions.ts).
// The timer is started once per process. Each call replaces the function it runs, so a
// reloaded module is not stuck forever on the copy that was loaded at boot.
const workerKey = Symbol.for("second-brain.article-suggestions");
// Bumped when the timer changes, so a running process swaps an older timer for this one
const WORKER_VERSION = 2;
// A pass still running after this long is treated as hung and a new pass starts beside it.
// That is safe: every job is leased (10 to 15 minutes), so the passes never share a job,
// and a hung pass that wakes up later loses its lease instead of overwriting the new one.
const STALLED_AFTER_MS = 20 * 60_000;
type SuggestionWorker = {
  timer?: ReturnType<typeof setInterval>;
  drain: () => Promise<number>;
  version?: number;
  busySince?: number | null;
};
export function startSuggestionWorker() {
  if (process.env.SUGGESTIONS_WORKER_ENABLED === "false" || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return;
  const state = globalThis as typeof globalThis & { [workerKey]?: SuggestionWorker };
  const current: SuggestionWorker = state[workerKey] ?? { drain: drainSuggestionWork };
  current.drain = drainSuggestionWork;
  state[workerKey] = current;
  if (current.timer && current.version === WORKER_VERSION) return;
  if (current.timer) clearInterval(current.timer);
  current.version = WORKER_VERSION;
  current.busySince = null;
  current.timer = setInterval(() => {
    const since = current.busySince;
    if (since != null && Date.now() - since < STALLED_AFTER_MS) return;
    if (since != null) console.warn("Article suggestions worker: the last pass has not finished in 20 minutes, starting a new one.");
    const started = Date.now();
    current.busySince = started;
    void forEachWorkerSpace(() => current.drain())
      .catch((error) => console.warn("Article suggestions worker failed:", error instanceof Error ? error.message : String(error)))
      .finally(() => { if (current.busySince === started) current.busySince = null; });
  }, 15_000);
  current.timer.unref?.();
}
