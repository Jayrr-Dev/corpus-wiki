import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "./localPostgres";

// POSTGRES ERROR CODES
const INSUFFICIENT_PRIVILEGE = "42501";
const FOREIGN_KEY_VIOLATION = "23503";

// Runs `sql` as `role` inside a transaction that is always rolled back
async function asRole(client: Client, role: string, sql: string) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    return await client.query(sql);
  } finally {
    await client.query("rollback");
  }
}

// Returns the Postgres error code a query fails with (or null if it succeeds)
async function errorCodeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

describe.skipIf(!hasLocalPostgres())("migration + seed on a throwaway Postgres", () => {
  let db: LocalPostgres;
  let client: Client;

  beforeAll(async () => {
    db = await startLocalPostgres();
    client = await db.connect();
  });

  afterAll(async () => {
    await client?.end();
    await db?.stop();
  });

  it("loads the Project Alpha seed", async () => {
    const { rows } = await client.query(`
      select (select count(*) from public.units)::int as units,
             (select count(*) from public.revisions)::int as revisions,
             (select count(*) from public.domains)::int as domains,
             (select slug from public.pages) as page`);
    expect(rows[0]).toEqual({ units: 2, revisions: 2, domains: 6, page: "project-alpha" });
  });

  it("lets authenticated read", async () => {
    const result = await asRole(client, "authenticated", "select count(*)::int as n from public.units");
    expect(result.rows[0]).toEqual({ n: 2 });
  });

  it("refuses writes from authenticated", async () => {
    const insert = `insert into public.sources (title, mime_type, source_date, hash, storage_path)
                    values ('x.md', 'text/markdown', now(), 'h', 'p')`;
    expect(await errorCodeOf(() => asRole(client, "authenticated", insert))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("refuses reads from anon", async () => {
    const read = () => asRole(client, "anon", "select * from public.units");
    expect(await errorCodeOf(read)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("refuses a unit with no revision at commit", async () => {
    const insertOrphanUnit = async () => {
      await client.query("begin");
      try {
        await client.query(`insert into public.units (kind, epistemic_status, current_revision_id, valid_from)
                            values ('fact', 'unknown', gen_random_uuid(), now())`);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    };
    expect(await errorCodeOf(insertOrphanUnit)).toBe(FOREIGN_KEY_VIOLATION);
  });
});
