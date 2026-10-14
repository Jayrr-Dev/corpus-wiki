import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "../../test/db/localPostgres";
import { parseMode, readMigrationFiles, runMigrations } from "./migrate";

// =====================================================================
// MIGRATION RUNNER TESTS (throwaway Postgres, temp migration folders)
// =====================================================================

// HELPERS: writes a temp migrations folder from { fileName: sql }
function writeMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sb-migrations-"));
  for (const [fileName, sql] of Object.entries(files)) writeFileSync(join(dir, fileName), sql);
  return dir;
}

// Versions the history table holds (it is dropped before each test)
async function recordedVersions(client: Client): Promise<string[]> {
  const result = await client.query<{ version: string }>(
    "select version from supabase_migrations.schema_migrations order by version",
  );
  return result.rows.map((row) => row.version);
}

describe("parseMode", () => {
  it("reads apply, status and baseline", () => {
    expect(parseMode([])).toEqual({ kind: "apply" });
    expect(parseMode(["--status"])).toEqual({ kind: "status" });
    expect(parseMode(["--baseline", "20261015000000"])).toEqual({ kind: "baseline", upTo: "20261015000000" });
    expect(() => parseMode(["--baseline"])).toThrow();
  });
});

describe("readMigrationFiles", () => {
  it("lists the repo migrations in version order", () => {
    const versions = readMigrationFiles().map((file) => file.version);
    expect(versions.length).toBeGreaterThan(0);
    expect([...versions].sort()).toEqual(versions);
  });
});

describe.skipIf(!hasLocalPostgres())("runMigrations on a throwaway Postgres", () => {
  let db: LocalPostgres;
  let client: Client;
  let dir: string;

  beforeAll(async () => {
    db = await startLocalPostgres({ withSeed: false });
  });
  afterAll(async () => {
    await db?.stop();
  });
  beforeEach(async () => {
    client = await db.connect();
    await client.query("drop schema if exists runner_test cascade; drop schema if exists supabase_migrations cascade");
  });
  afterEach(async () => {
    await client.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies pending files once, in order, and records them", async () => {
    dir = writeMigrations({
      "100_schema.sql": "create schema runner_test; create table runner_test.t (n int);",
      "200_row.sql": "insert into runner_test.t values (1);",
    });
    const files = readMigrationFiles(dir);

    const first = await runMigrations(client, { kind: "apply" }, files);
    const second = await runMigrations(client, { kind: "apply" }, files);

    expect(first.ran.map((file) => file.version)).toEqual(["100", "200"]);
    expect(second.ran).toEqual([]);
    expect(await recordedVersions(client)).toEqual(["100", "200"]);
    expect((await client.query("select count(*)::int as n from runner_test.t")).rows[0].n).toBe(1);
  });

  it("rolls back a failing file and leaves it pending", async () => {
    dir = writeMigrations({
      "100_schema.sql": "create schema runner_test;",
      "200_broken.sql": "create table runner_test.half (n int); select missing_column from nowhere;",
    });

    await expect(runMigrations(client, { kind: "apply" }, readMigrationFiles(dir))).rejects.toThrow(/200_broken/);

    expect(await recordedVersions(client)).toEqual(["100"]);
    const half = await client.query("select to_regclass('runner_test.half') as t");
    expect(half.rows[0].t).toBeNull();
  });

  it("baseline records files without running them; status changes nothing", async () => {
    dir = writeMigrations({
      "100_schema.sql": "create schema runner_test;",
      "200_table.sql": "create table runner_test.t (n int);",
    });
    const files = readMigrationFiles(dir);

    const baseline = await runMigrations(client, { kind: "baseline", upTo: "100" }, files);
    const status = await runMigrations(client, { kind: "status" }, files);

    expect(baseline.ran.map((file) => file.version)).toEqual(["100"]);
    expect(status.pending.map((file) => file.version)).toEqual(["200"]);
    const schema = await client.query("select to_regnamespace('runner_test') as s");
    expect(schema.rows[0].s).toBeNull();
  });
});
