import "server-only";

import { getReconciliationClient } from "@/lib/ai/factory";
import type { ReconciliationClient } from "@/lib/ai/types";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import { getSectionWriter, type SectionWriter } from "@/lib/living-page";
import { getAdminSupabase } from "@/lib/supabase/admin";

// SERVER DEPENDENCIES: the database port and the two AI clients, built from env.
// Server actions take them from here; tests build their own (pg + fakes).
export type ServerDeps = { db: DbRpc; reconciler: ReconciliationClient; writer: SectionWriter };

export function getServerDeps(): ServerDeps {
  return { db: supabaseRpc(getAdminSupabase()), reconciler: getReconciliationClient(), writer: getSectionWriter() };
}
