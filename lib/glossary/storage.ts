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
};

export type GlossaryUpdate = Database["public"]["Tables"]["glossary_state"]["Update"];
export const glossaryClient = (client: SupabaseClient<Database>) => client;
