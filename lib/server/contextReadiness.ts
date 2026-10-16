import "server-only";
import type { AdminSupabase } from "@/lib/supabase/admin";

export const CONTEXT_UPDATE_REQUIRED = "The knowledge context database update is required before processing knowledge or saving context. The last migration failed; existing saved knowledge is still available.";

// Old Change Control functions ignore unknown action fields. Fail before drafting
// or saving context rather than reporting an ignored context change as successful.
export async function requireContextStorage(client: AdminSupabase): Promise<void> {
  const { error } = await client.from("revisions").select("knowledge_context").limit(1);
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204" || error.message.includes("knowledge_context")) throw new Error(CONTEXT_UPDATE_REQUIRED);
    throw new Error(error.message);
  }
}
