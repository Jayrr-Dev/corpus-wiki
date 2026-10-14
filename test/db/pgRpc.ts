import type { Client } from "pg";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";

// PG ADAPTER FOR TESTS: `select public.fn(p_a => $1, ...)` on a plain pg connection.
// Objects and arrays are sent as JSON text; Postgres casts them to the jsonb parameter.
export function pgRpc(client: Client): DbRpc {
  return {
    async call<T>(fn: string, args: RpcArgs = {}): Promise<T> {
      const names = Object.keys(args);
      const params = names.map((name) => toParam(args[name]));
      const placeholders = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
      const { rows } = await client.query<{ result: T }>(`select public.${fn}(${placeholders}) as result`, params);
      return rows[0]?.result as T;
    },
  };
}

// Plain values pass through; objects and arrays become JSON text
function toParam(value: unknown): unknown {
  if (value === undefined) return null;
  return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
}
