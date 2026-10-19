import "server-only";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { optimizedMediaResponse, removeMediaCache } from "./optimize";
import { replaceStoredMedia } from "./replace";
import { forEachWorkerSpace } from "@/lib/spaces/workers";

export async function optimizeNextStoredMedia() {
  const client = getAdminSupabase(), db = supabaseRpc(client);
  const job = await db.call<{ bucket: string; path: string; mime: string } | null>("claim_media_optimization");
  if (!job) return false;
  let success = false;
  try {
    // Clear display derivatives so a cache hit cannot skip storage compaction.
    await removeMediaCache(job.bucket, job.path);
    const response = await optimizedMediaResponse(new Request("http://media.local/compact?w=2400"), {
      ...job, replace: (bytes, mime) => replaceStoredMedia(job.bucket, job.path, bytes, mime),
      download: async () => {
        const result = await client.storage.from(job.bucket).download(job.path);
        if (result.error || !result.data) throw new Error("Media file unavailable");
        return result.data;
      },
    });
    if (!response) throw new Error("Could not compact stored media");
    await response.arrayBuffer();
    // Background conversion keeps only the canonical storage file; display
    // derivatives can be recreated later at the size the browser actually needs.
    await removeMediaCache(job.bucket, job.path);
    success = true;
  } finally {
    await db.call("finish_media_optimization", { p_bucket: job.bucket, p_path: job.path, p_success: success });
  }
  return true;
}

const key = Symbol.for("second-brain.media-optimization");
export function startMediaOptimizationWorker() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return;
  const state = globalThis as typeof globalThis & { [key]?: ReturnType<typeof setInterval> };
  if (state[key]) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await forEachWorkerSpace(optimizeNextStoredMedia); }
    catch (error) { console.warn("Media storage optimization will retry:", error instanceof Error ? error.message : String(error)); }
    finally { busy = false; }
  };
  state[key] = setInterval(() => void tick(), 60_000);
  state[key].unref?.();
  void tick();
}
