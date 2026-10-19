import "server-only";
import { withSpaceActor } from "@/lib/auth/currentPerson";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

// Timer/scheduler workers visit every space with an immutable actor context,
// including all awaits and heartbeats. Discard any request context inherited
// when a timer happened to be started during a person's request.
export async function forEachWorkerSpace<T>(run: () => Promise<T>): Promise<T[]> {
  return withSpaceActor({ personId: null, via: "script" }, async () => {
    const ids = await supabaseRpc(getAdminSupabase()).call<string[]>("worker_spaces");
    const results: T[] = [];
    for (const spaceId of ids) {
      await withSpaceActor({ personId: null, via: "script", spaceId }, async () => {
        try { results.push(await run()); }
        catch (error) { console.warn("A background task failed in its space:", error instanceof Error ? error.message : String(error)); }
      });
    }
    return results;
  });
}
