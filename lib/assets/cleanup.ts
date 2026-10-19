import "server-only";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc, type DbRpc } from "@/lib/db/rpc";
import { removeMediaCache, sweepMediaCache } from "@/lib/media/optimize";
import { forEachWorkerSpace } from "@/lib/spaces/workers";

type PendingFile = { id: string; bucket: string; path: string };

export async function cleanAssetFiles(db: DbRpc, remove: (bucket: string, path: string) => Promise<void>) {
  const files = await db.call<PendingFile[]>("pending_asset_file_cleanup");
  for (const file of files) {
    try {
      await remove(file.bucket, file.path);
      await db.call("finish_asset_file_cleanup", { p_id: file.id });
    } catch (error) {
      console.warn("Asset file cleanup will retry:", error instanceof Error ? error.message : String(error));
    }
  }
}

export async function runAssetCleanup() {
  const client = getAdminSupabase();
  const db = supabaseRpc(client);
  const deleted = await db.call<number>("expire_deleted_assets");
  await cleanAssetFiles(db, async (bucket, path) => {
    const { error } = await client.storage.from(bucket).remove([path]);
    if (error) throw new Error(error.message);
    await removeMediaCache(bucket, path);
  });
  await sweepMediaCache();
  return deleted;
}

const workerKey = Symbol.for("second-brain.asset-cleanup-worker");
export function startAssetCleanupWorker() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return;
  const state = globalThis as typeof globalThis & { [workerKey]?: ReturnType<typeof setInterval> };
  if (state[workerKey]) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await forEachWorkerSpace(runAssetCleanup); }
    catch (error) { console.warn("Asset cleanup failed:", error instanceof Error ? error.message : String(error)); }
    finally { busy = false; }
  };
  state[workerKey] = setInterval(() => void tick(), 60 * 60 * 1000);
  state[workerKey].unref?.();
  void tick();
}
