import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import { processingMetric } from "@/lib/processing/metrics";

// =====================================================================
// DATABASE FUNCTION PORT: every write (and the multi-table reads the
// pipeline needs) is one Postgres function. Server code calls them through
// this port, so the same pipeline runs on Supabase (the app) and on a
// plain pg connection (tests and evals) without a second implementation.
// Arguments are named (`p_*`); objects and arrays travel as jsonb.
// =====================================================================

export type RpcArgs = Record<string, unknown>;

export interface DbRpc {
  // Calls `public.<fn>(args)` and returns its (jsonb) result
  call<T>(fn: string, args?: RpcArgs): Promise<T>;
}

// PostgREST answers these before the call reaches Postgres (schema cache reloading after a
// migration, or no database connection), so retrying can never run a write twice.
const NOT_EXECUTED = new Set(["PGRST000", "PGRST001", "PGRST002"]);
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 15000];
// These processing readers are SQL STABLE functions: replaying them cannot
// duplicate a write. Keep this explicit; POST is also used for ordinary writes.
const REPLAYABLE_READS = new Set([
  "get_workspace_settings", "get_glossary_auto_decide", "get_ai_role_instructions", "get_ai_skill_library", "get_all_role_memory", "get_role_memory",
  "read_upload_workflows", "upload_knowledge_result", "upload_workflow_waiting", "upload_unplaced_claims", "upload_article_inputs",
  "reconciliation_input", "entity_cleanup_input", "event_touched_entities", "entity_profiles_missing", "entity_profile_evidence",
  "missing_glossary_embeddings", "missing_unit_embeddings", "missing_passage_embeddings", "search_glossary", "similar_units", "similar_passages", "unit_vectors",
  "article_index", "page_candidates", "list_affected_sections", "list_page_sections", "living_page_event_units", "living_page_change_summary",
  "read_section_state", "read_section_units", "read_page_context", "page_review_snapshot", "page_review_related", "page_review_status",
  "pages_needing_editorial_review", "curator_snapshot", "domain_review_snapshot",
]);
// A broken database connection can surface as an empty HTTP 400/5xx, with
// no evidence of whether it committed. Only these token-fenced operations can
// be replayed: checkpoints replace the same value and workflow writes return
// their transactionally saved result. Never extend this to ordinary writes.
const REPLAYABLE_WORKFLOW = new Set([
  "assert_upload_lease", "start_upload_step", "finish_upload_step", "report_upload_progress",
  "release_upload_workflow", "upload_workflow_write",
]);

// SUPABASE ADAPTER: the admin client's `rpc` (secret key, server only)
export function supabaseRpc(client: SupabaseClient<Database>): DbRpc {
  return {
    async call<T>(fn: string, args: RpcArgs = {}): Promise<T> {
      // The generated types list each function; this port is generic, so the name is widened once here
      const rpc = client.rpc as unknown as (f: string, a: RpcArgs) => PromiseLike<{ data: unknown; error: { message: string; code?: string; details?: string; hint?: string } | null; status?: number; statusText?: string }>;
      for (let attempt = 0; ; attempt++) {
        const started = performance.now();
        let response: Awaited<ReturnType<typeof rpc>>;
        try { response = await rpc.call(client, fn, args); }
        finally { processingMetric(`db.${fn}`, performance.now() - started); }
        const { data, error, status, statusText } = response;
        if (!error) return data as T;
        const replayable = REPLAYABLE_READS.has(fn) || (REPLAYABLE_WORKFLOW.has(fn) && typeof args.p_event_id === "string" && typeof args.p_token === "string");
        const replayableEmptyResponse = replayable
          && !error.code && !error.message?.trim() && !error.details?.trim() && !error.hint?.trim()
          && (status === 400 || (status !== undefined && status >= 500));
        const timedOutRead = REPLAYABLE_READS.has(fn) && error.code === "57014" && /statement timeout/i.test(error.message) && attempt < 2;
        if ((!NOT_EXECUTED.has(error.code ?? "") && !replayableEmptyResponse && !timedOutRead) || attempt >= RETRY_DELAYS_MS.length) {
          const message = error.message?.trim() || error.details?.trim() || error.hint?.trim()
            || [error.code, status, statusText].filter(Boolean).join(" ") || "Database request failed without error details";
          throw new Error(`${fn}: ${message}`);
        }
        processingMetric(`db.retry.${fn}`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    },
  };
}
