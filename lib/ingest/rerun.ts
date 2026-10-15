import "server-only";

import { getAdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// RE-RUNNING AN UPLOAD: the file is already stored and its passages are
// recorded, so a re-run only repeats step 2 (reconcile -> commit ->
// rebuild) with the model picked on /settings now.
//   retry  a FAILED upload event runs again (same event, same row)
//   rerun  any source gets a fresh upload event (its file is read again)
// =====================================================================

// RETRY GUARD: only a failed upload event may run again (an applied one would apply twice)
export async function requireFailedUpload(eventId: string): Promise<void> {
  const { data: event, error } = await getAdminSupabase().from("shift_events").select("cause, status").eq("id", eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!event || event.cause !== "upload") throw new Error("That upload no longer exists.");
  if (event.status !== "failed") throw new Error("Only a failed upload can be retried.");
}

// RERUN: opens a new 'received' upload event for a stored source; returns its id
export async function openRerunEvent(sourceId: string): Promise<string> {
  const { data: source, error: sourceError } = await getAdminSupabase().from("sources").select("archived_at").eq("id", sourceId).maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!source) throw new Error("That source no longer exists.");
  // An archived file is not evidence: what a re-run cites would be stale at once
  if (source.archived_at) throw new Error("This source is archived. Restore it before re-running it.");
  const { data: event, error } = await getAdminSupabase()
    .from("shift_events")
    .insert({ cause: "upload", source_id: sourceId, actor: "ai", status: "received" })
    .select("id")
    .single();
  if (error) throw new Error(`Could not start the re-run: ${error.message}`);
  return event.id;
}
