import type { DbRpc } from "@/lib/db/rpc";
import type { ComposerSnapshot } from "./types";
export type ComposerClaim = { pageId: string; token: string; snapshot: ComposerSnapshot };

export async function runComposerClaim<T>(db: DbRpc, claim: ComposerClaim, run: (guard: () => Promise<void>) => Promise<T>): Promise<T> {
  let lost = false, renewing = false;
  const guard = async () => {
    if (lost || !await db.call<boolean>("renew_composer_job", { p_page_id: claim.pageId, p_token: claim.token })) {
      lost = true; throw new Error("Composer's request was superseded. No illustrations were replaced.");
    }
  };
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void guard().catch(() => { lost = true; }).finally(() => { renewing = false; });
  }, 30_000);
  heartbeat.unref?.();
  let error: string | null = null;
  try { return await run(guard); }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught); throw caught; }
  finally {
    clearInterval(heartbeat);
    await db.call("finish_composer_job", { p_page_id: claim.pageId, p_token: claim.token, p_error: error });
  }
}
