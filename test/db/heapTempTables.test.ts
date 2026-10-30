import { portablePostgres } from "@/test/db/portablePostgres";
import { afterAll, beforeAll, expect, it } from "vitest";

// Temp tables in upload functions must not be OrioleDB tables (20261128200000_heap_temp_tables.sql)
let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });

it("creates every temporary table in a function body with heap", async () => {
  const { rows } = await store.pg.query<{ fn: string }>(`select p.proname fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','change_control') and p.prosrc ~* 'create\s+temp(orary)?\s+table' and p.prosrc !~* 'using\s+heap'`);
  expect(rows.map((row) => row.fn)).toEqual([]);
});
