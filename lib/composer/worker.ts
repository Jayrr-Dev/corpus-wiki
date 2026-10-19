import "server-only";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { composeNextAutomatic } from "./live";
import { forEachWorkerSpace } from "@/lib/spaces/workers";

export async function processOneComposerJob(): Promise<boolean> {
  return composeNextAutomatic(supabaseRpc(getAdminSupabase()));
}
const workerKey = Symbol.for("second-brain.composer-worker");
export function startComposerWorker() {
  if (process.env.COMPOSER_AUTO_ENABLED === "false" || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY || !(process.env.NEBIUS_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY)) return;
  const state = globalThis as typeof globalThis & { [workerKey]?: ReturnType<typeof setInterval> };
  if (state[workerKey]) return;
  let busy = false;
  const tick = async () => {
    if (busy || process.env.COMPOSER_AUTO_ENABLED === "false") return;
    busy = true;
    try { await forEachWorkerSpace(processOneComposerJob); }
    catch (error) { console.warn("Automatic Composer assessment failed:", error instanceof Error ? error.message : String(error)); }
    finally { busy = false; }
  };
  state[workerKey] = setInterval(() => void tick(), 15_000);
  state[workerKey].unref?.();
}
