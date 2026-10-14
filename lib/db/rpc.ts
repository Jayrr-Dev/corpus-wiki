import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";

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

// SUPABASE ADAPTER: the admin client's `rpc` (secret key, server only)
export function supabaseRpc(client: SupabaseClient<Database>): DbRpc {
  return {
    async call<T>(fn: string, args: RpcArgs = {}): Promise<T> {
      // The generated types list each function; this port is generic, so the name is widened once here
      const rpc = client.rpc as unknown as (f: string, a: RpcArgs) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await rpc.call(client, fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data as T;
    },
  };
}
