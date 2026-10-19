import "server-only";
import type { DbRpc } from "@/lib/db/rpc";

type Batch = { eventId: string; complete: boolean; position: number } | { error: string; changeSetId: string };

// Short transactions keep a durable cursor. A lost response or worker restart
// simply continues with the next batch, protected by the database job lock.
export async function applyRootApprovalBatches(db: DbRpc, continueUpload: (eventId: string) => Promise<unknown>, limit = 8): Promise<void> {
  for (let count = 0; count < limit; count++) {
    const result = await db.call<Batch | null>("apply_root_approval_batch");
    if (!result) return;
    if ("error" in result) throw new Error(`Applying approved domains paused: ${result.error}`);
    if (result.complete) await continueUpload(result.eventId);
  }
}

export async function runRootApprovalRecovery(): Promise<void> {
  const [{ forEachWorkerSpace }, { getAdminSupabase }, { supabaseRpc }, { processUploadEvent }] = await Promise.all([
    import("@/lib/spaces/workers"), import("@/lib/supabase/admin"), import("@/lib/db/rpc"), import("@/lib/ingest"),
  ]);
  await forEachWorkerSpace(() => applyRootApprovalBatches(supabaseRpc(getAdminSupabase()), (eventId) => processUploadEvent(eventId, "articles", true)));
}

const workerKey = Symbol.for("second-brain.root-approvals");
export function startRootApprovalWorker(): void {
  const state = globalThis as typeof globalThis & { [workerKey]?: ReturnType<typeof setInterval> };
  if (state[workerKey]) return;
  let busy = false;
  state[workerKey] = setInterval(() => {
    if (busy) return;
    busy = true;
    void runRootApprovalRecovery().catch((error) => console.error("Root approval recovery failed:", error))
      .finally(() => { busy = false; });
  }, 10_000);
  state[workerKey].unref?.();
}
