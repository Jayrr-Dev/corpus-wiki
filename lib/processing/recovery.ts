import type { DbRpc } from "@/lib/db/rpc";
import { processingCancellation } from "./cancellation";

export async function recoverOneUpload(db: DbRpc, run: (eventId: string) => Promise<unknown>, budgetMs = 240_000): Promise<boolean> {
  const claim = await db.call<{ eventId: string; token: string } | null>("claim_upload_recovery");
  if (!claim) return false;
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(new Error("Processing continuation budget reached; saved work will resume.")), budgetMs);
  deadline.unref?.();
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void db.call<boolean>("renew_upload_recovery", { p_event_id: claim.eventId, p_token: claim.token })
      .then((owned) => { if (!owned) abort.abort(new Error("Recovery ownership expired.")); })
      .catch((error) => abort.abort(error)).finally(() => { renewing = false; });
  }, 30_000);
  heartbeat.unref?.();
  let error: string | null = null;
  try { await processingCancellation.run(abort.signal, () => run(claim.eventId)); }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  finally {
    clearTimeout(deadline); clearInterval(heartbeat);
    await db.call("finish_upload_recovery", { p_event_id: claim.eventId, p_token: claim.token, p_error: error });
  }
  return true;
}

async function runRecovery(budgetMs = 240_000): Promise<boolean> {
  // The scheduler also drains approval batches on hosts without a resident worker.
  const { runRootApprovalRecovery } = await import("./rootApprovals");
  await runRootApprovalRecovery();
  const [{ getAdminSupabase }, { supabaseRpc }, { processUploadEvent }] = await Promise.all([
    import("@/lib/supabase/admin"), import("@/lib/db/rpc"), import("@/lib/ingest"),
  ]);
  const { forEachWorkerSpace } = await import("@/lib/spaces/workers");
  const results = await forEachWorkerSpace(() => recoverOneUpload(supabaseRpc(getAdminSupabase()), async (eventId) => {
    const result = await processUploadEvent(eventId, "articles", true);
    if (result.error) throw new Error(result.error);
    return result;
  }, budgetMs));
  return results.some(Boolean);
}

// Always-on Node deployments recover independently of browser requests. Serverless hosts use the protected
// recovery endpoint from their scheduler instead of relying on an in-process timer.
const workerKey = Symbol.for("second-brain.upload-recovery");
export function startUploadRecoveryWorker(): void {
  const state = globalThis as typeof globalThis & { [workerKey]?: ReturnType<typeof setInterval> };
  if (state[workerKey]) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    // A resident worker has no HTTP deadline. Give long planning calls room to
    // finish rather than repeatedly aborting them at the serverless deadline.
    try { await runRecovery(30 * 60_000); }
    catch (error) { console.error("Upload recovery worker failed:", error instanceof Error ? error.message : error); }
    finally { busy = false; }
  };
  state[workerKey] = setInterval(() => void tick(), 15_000);
  state[workerKey].unref?.();
  void tick();
}
export const runScheduledRecovery = () => runRecovery();
