import "server-only";

import { getReconciliationClient } from "@/lib/ai/factory";
import { readChosenModel } from "@/lib/ai/models";
import type { ReconciliationClient } from "@/lib/ai/types";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import { getSectionWriter, type SectionWriter } from "@/lib/living-page";
import { getAdminSupabase } from "@/lib/supabase/admin";

// SERVER DEPENDENCIES: the database port and the two AI clients, built from env
// plus the model picked on /settings (read on every call, so a new pick applies at once).
// Server actions take them from here; tests build their own (pg + fakes).
export type ServerDeps = { db: DbRpc; reconciler: ReconciliationClient; writer: SectionWriter };

export async function getServerDeps(): Promise<ServerDeps> {
  const db = supabaseRpc(getAdminSupabase());
  const chosenModel = await readChosenModel(db);
  return { db, reconciler: getReconciliationClient(process.env, chosenModel), writer: getSectionWriter(process.env, chosenModel) };
}
