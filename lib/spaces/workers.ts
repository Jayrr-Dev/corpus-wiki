import "server-only";
import { withSpaceActor } from "@/lib/auth/currentPerson";
import { databaseBackoff, databaseUnavailable } from "@/lib/db/backoff";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

// Timer/scheduler workers visit every space with an immutable actor context,
// including all awaits and heartbeats. Discard any request context inherited
// when a timer happened to be started during a person's request.
// While the database is struggling every worker skips its pass (see lib/db/backoff.ts).
export async function forEachWorkerSpace<T>(run: () => Promise<T>): Promise<T[]> {
  if (databaseBackoff.paused()) return [];
  return withSpaceActor({ personId: null, via: "script" }, async () => {
    let ids: string[];
    try { ids = await supabaseRpc(getAdminSupabase()).call<string[]>("worker_spaces"); }
    catch (error) { databaseBackoff.failed(); throw error; }
    const results: T[] = [];
    let unavailable = false;
    for (const spaceId of ids) {
      if (unavailable) break;
      await withSpaceActor({ personId: null, via: "script", spaceId }, async () => {
        try { results.push(await run()); }
        catch (error) {
          if (databaseUnavailable(error)) { unavailable = true; databaseBackoff.failed(); }
          console.warn("A background task failed in its space:", error instanceof Error ? error.message : String(error));
        }
      });
    }
    if (!unavailable) databaseBackoff.succeeded();
    return results;
  });
}
