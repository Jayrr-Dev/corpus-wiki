import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import type { GlossaryEntry, GlossaryOverride, PendingGlossaryEntry } from "./entries";

export type GlossaryState = {
  id: boolean; entries: GlossaryEntry[]; batches: Record<string, GlossaryEntry[]>;
  input_hash: string | null; generated_at: string | null;
  status: "idle" | "generating" | "ready" | "error";
  completed_batches: number; total_batches: number; error: string | null;
  lease_token: string | null; lease_until: string | null;
  pending_entries?: PendingGlossaryEntry[]; identity_registry?: Record<string, string>; definition_overrides?: Record<string, GlossaryOverride>;
  review_cache?: Record<string, unknown>;
  live_entries?: GlossaryEntry[]; live_input_hash?: string | null;
};

export type GlossaryUpdate = Database["public"]["Tables"]["glossary_state"]["Update"];
export const glossaryClient = (client: SupabaseClient<Database>) => client;

export type GlossaryView = Pick<GlossaryState, "entries" | "live_entries" | "pending_entries" | "generated_at" | "status" | "completed_batches" | "total_batches" | "error" | "lease_until"> & {
  review_progress?: { phase: "normalizing" | "comparing"; completed: number; total: number } | null;
};

export async function readGlossaryView(client: SupabaseClient<Database>): Promise<GlossaryView | null> {
  const rpc = client.rpc as unknown as (name: string) => PromiseLike<{ data: GlossaryView | null; error: { message: string } | null }>;
  const { data, error } = await rpc.call(client, "read_glossary_view");
  if (error) throw new Error(error.message);
  return data;
}
