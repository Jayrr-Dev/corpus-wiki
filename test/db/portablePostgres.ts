import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";

// Real PostgreSQL in WASM: isolated, cross-platform, with the complete migration chain.
// No cloud credentials, external server, or live AI calls are used.
export async function portablePostgres() {
  const pg = new PGlite({ extensions: { vector } });
  await pg.exec(await readFile(resolve("test/db/supabase-stubs.sql"), "utf8"));
  for (const file of (await readdir(resolve("supabase/migrations"))).filter((file) => file.endsWith(".sql")).sort()) {
    await pg.exec(await readFile(resolve("supabase/migrations", file), "utf8"));
  }
  await pg.exec(await readFile(resolve("supabase/seed.sql"), "utf8"));
  const db: DbRpc = { async call<T>(fn: string, args: RpcArgs = {}): Promise<T> {
    if (!/^[a-z_]+$/.test(fn)) throw new Error("Invalid RPC name");
    const types = await pg.query<{ name: string; type: string }>(`select p.proargnames[i] name, format_type(p.proargtypes[i-1],null) type
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace, generate_series(1,p.pronargs) i
      where n.nspname='public' and p.proname=$1 order by i`, [fn]);
    const named = types.rows.filter((arg) => Object.hasOwn(args, arg.name));
    const parameters = named.map((arg) => `${arg.name} => a.${arg.name}`).join(",");
    const from = named.length ? ` from jsonb_to_record($1) as a(${named.map((arg) => `${arg.name} ${arg.type}`).join(",")})` : "";
    const result = await pg.query<{ result: T }>(`select public.${fn}(${parameters}) as result${from}`, named.length ? [JSON.stringify(args)] : []);
    const signature = await pg.query<{ returns_set: boolean }>(`select p.proretset returns_set from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    // PostgREST returns SETOF functions as arrays, including empty results.
    return (signature.rows[0]?.returns_set ? result.rows.map((row) => row.result) : result.rows[0]?.result) as T;
  } };
  return { pg, db };
}
