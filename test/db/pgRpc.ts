import type { Client } from "pg";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";

// PG ADAPTER FOR TESTS: calls `public.fn(p_a => ..., ...)` on a plain pg connection
// the way PostgREST does. Arguments go over as one JSON object and are cast to
// each parameter's declared type (uuid[], text[], jsonb, ...), and SETOF
// functions return every row as an array, empty results included.

// TYPES
type Signature = { returnsSet: boolean; params: { name: string; type: string }[] };

export function pgRpc(client: Client): DbRpc {
  return {
    async call<T>(fn: string, args: RpcArgs = {}): Promise<T> {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`Invalid RPC name ${fn}`);
      const given = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
      const signature = await pickSignature(client, fn, Object.keys(given));
      const named = signature.params.filter((param) => Object.hasOwn(given, param.name));
      const call = named.map((param) => `${param.name} => a.${param.name}`).join(", ");
      const from = named.length ? ` from jsonb_to_record($1) as a(${named.map((param) => `${param.name} ${param.type}`).join(", ")})` : "";
      const { rows } = await client.query<{ result: T }>(`select public.${fn}(${call}) as result${from}`, named.length ? [JSON.stringify(given)] : []);
      return (signature.returnsSet ? rows.map((row) => row.result) : rows[0]?.result) as T;
    },
  };
}

// The input parameters of public.fn; with overloads, the one that takes every
// given argument and the fewest others
async function pickSignature(client: Client, fn: string, names: string[]): Promise<Signature> {
  const { rows } = await client.query<{ oid: number; returns_set: boolean; name: string | null; type: string | null }>(`
    select p.oid::int as oid, p.proretset as returns_set, a.name, format_type(a.type, null) as type
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join lateral unnest(
      coalesce(p.proallargtypes, p.proargtypes::oid[]),
      p.proargnames,
      coalesce(p.proargmodes, array_fill('i'::"char", array[p.pronargs]))
    ) with ordinality as a(type, name, mode, position) on a.mode in ('i', 'b', 'v')
    where n.nspname = 'public' and p.proname = $1
    order by p.oid, a.position`, [fn]);
  const byOid = new Map<number, Signature>();
  for (const row of rows) {
    const signature = byOid.get(row.oid) ?? { returnsSet: row.returns_set, params: [] };
    if (row.name && row.type) signature.params.push({ name: row.name, type: row.type });
    byOid.set(row.oid, signature);
  }
  const fits = [...byOid.values()]
    .filter((signature) => names.every((name) => signature.params.some((param) => param.name === name)))
    .sort((a, b) => a.params.length - b.params.length);
  if (!fits[0]) throw new Error(`No public.${fn} takes ${names.join(", ") || "no arguments"}`);
  return fits[0];
}
