import { AsyncLocalStorage } from "node:async_hooks";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";

// Request-local: other uploads and manual page edits never inherit this run.
// `signal` aborts when the run loses its lease or is cancelled; AI calls made inside the run listen to it.
export const uploadExecution = new AsyncLocalStorage<{ eventId: string; token: string; db: DbRpc; signal?: AbortSignal }>();

// HOW FAR A LONG ROLE HAS GOT, shown live on the upload's status line. Also a lease check,
// so a cancel stops the run at the next batch or section.
export type UploadProgress = { step: string; done: number; total: number };
export async function reportUploadProgress(progress: UploadProgress): Promise<void> {
  const execution = uploadExecution.getStore();
  if (execution) await execution.db.call("report_upload_progress", { p_event_id: execution.eventId, p_token: execution.token, p_progress: progress });
}

export async function assertActiveUpload(): Promise<void> {
  const execution = uploadExecution.getStore();
  if (execution) await execution.db.call("assert_upload_lease", { p_event_id: execution.eventId, p_token: execution.token });
}

/** A stable operation key identifies intent, not generated wording. The database
 * saves the write and its result in the same transaction, including lost replies. */
export async function workflowWrite<T>(db: DbRpc, key: string, fn: string, args: RpcArgs): Promise<T> {
  const execution = uploadExecution.getStore();
  if (!execution) return db.call<T>(fn, args);
  return execution.db.call<T>("upload_workflow_write", {
    p_event_id: execution.eventId, p_token: execution.token,
    p_key: key, p_function: fn, p_args: args,
  });
}

export async function workflowStep<T>(key: string, run: () => Promise<T>): Promise<T> {
  const execution = uploadExecution.getStore();
  if (!execution) return run();
  const args = { p_event_id: execution.eventId, p_token: execution.token, p_key: key };
  const saved = await execution.db.call<{ done: boolean; output: T }>("start_upload_step", args);
  if (saved.done) return saved.output;
  try {
    const result = await run();
    await execution.db.call("finish_upload_step", { ...args, p_output: result ?? null, p_error: null });
    return result;
  } catch (error) {
    await execution.db.call("finish_upload_step", { ...args, p_output: null, p_error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
