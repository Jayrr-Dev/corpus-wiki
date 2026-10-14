import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

// =====================================================================
// DATABASE MIGRATION RUNNER
// Applies the pending files in supabase/migrations to the database named
// by SUPABASE_DB_URL, over a direct Postgres connection.
//
// WHY: schema changes used to go through the Supabase connector, which
// stops for a confirmation on any DROP or DELETE that nobody can answer
// from a thread, so changes stalled. A plain Postgres connection has no
// such prompt, and the same command runs locally and in a Claude session.
//
// HOW: every file runs in its own transaction together with its row in
// supabase_migrations.schema_migrations (the table the Supabase CLI and
// dashboard use), so a file is either fully applied and recorded or not
// at all. An advisory lock stops two runners applying at once.
//
// USAGE
//   npm run db:migrate                         apply pending migrations
//   npm run db:migrate -- --status             list applied and pending, change nothing
//   npm run db:migrate -- --baseline <version> record files up to <version> as applied
//                                              without running them (adopts a database
//                                              whose schema was built another way)
// =====================================================================

// SETTINGS
const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
// Supabase's public root CA, so the connection is verified, not just encrypted
const SUPABASE_CA_FILE = join(REPO_ROOT, "supabase", "certs", "prod-ca-2021.crt");
const LOCK_KEY = "second-brain-engine:migrations";
// "20261014000000_initial_schema.sql" -> version "20261014000000", name "initial_schema"
const FILE_NAME_PATTERN = /^(\d+)_(.+)\.sql$/;

// TYPES
export type MigrationFile = { version: string; name: string; path: string };
export type Mode = { kind: "apply" } | { kind: "status" } | { kind: "baseline"; upTo: string };
export type MigrationReport = { applied: MigrationFile[]; pending: MigrationFile[]; ran: MigrationFile[] };

// =====================================================================
// READING THE MIGRATION FILES
// =====================================================================

// Every migration file in version order; a badly named .sql file is an error, not a skip
export function readMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
    .map((fileName) => {
      const match = FILE_NAME_PATTERN.exec(fileName);
      if (!match?.[1] || !match[2]) throw new Error(`Migration file name must be <version>_<name>.sql: ${fileName}`);
      return { version: match[1], name: match[2], path: join(dir, fileName) };
    });
}

// =====================================================================
// THE HISTORY TABLE (same shape the Supabase CLI creates)
// =====================================================================

// Creates the history table when this database has never had one
async function ensureHistoryTable(client: pg.Client): Promise<void> {
  await client.query("create schema if not exists supabase_migrations");
  await client.query(
    "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)",
  );
}

// The versions this database has already recorded
async function readAppliedVersions(client: pg.Client): Promise<Set<string>> {
  const result = await client.query<{ version: string }>("select version from supabase_migrations.schema_migrations");
  return new Set(result.rows.map((row) => row.version));
}

// Records one file as applied; `statements` is null for a baseline (nothing ran)
async function recordVersion(client: pg.Client, file: MigrationFile, statements: string[] | null): Promise<void> {
  await client.query(
    "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)",
    [file.version, file.name, statements],
  );
}

// =====================================================================
// APPLYING
// =====================================================================

// Runs one file and records it in one transaction; on any error nothing of it stays
async function applyFile(client: pg.Client, file: MigrationFile): Promise<void> {
  const sql = readFileSync(file.path, "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await recordVersion(client, file, [sql]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw new Error(`Migration ${file.version}_${file.name} failed and was rolled back: ${(error as Error).message}`);
  }
}

// Records every file up to `upTo` as applied without running it
async function baselineFiles(client: pg.Client, files: MigrationFile[], upTo: string): Promise<MigrationFile[]> {
  const toRecord = files.filter((file) => file.version <= upTo);
  await client.query("begin");
  for (const file of toRecord) await recordVersion(client, file, null);
  await client.query("commit");
  return toRecord;
}

// Brings the database up to date (or reports / baselines) while holding the advisory lock
export async function runMigrations(client: pg.Client, mode: Mode, files = readMigrationFiles()): Promise<MigrationReport> {
  await client.query("select pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
  try {
    await ensureHistoryTable(client);
    const appliedVersions = await readAppliedVersions(client);
    const applied = files.filter((file) => appliedVersions.has(file.version));
    const pending = files.filter((file) => !appliedVersions.has(file.version));

    if (mode.kind === "status") return { applied, pending, ran: [] };
    if (mode.kind === "baseline") return { applied, pending, ran: await baselineFiles(client, pending, mode.upTo) };

    const ran: MigrationFile[] = [];
    for (const file of pending) {
      await applyFile(client, file);
      ran.push(file);
    }
    return { applied, pending, ran };
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
  }
}

// =====================================================================
// COMMAND LINE
// =====================================================================

// Reads --status / --baseline <version> from the arguments
export function parseMode(args: string[]): Mode {
  if (args.includes("--status")) return { kind: "status" };
  const baselineAt = args.indexOf("--baseline");
  if (baselineAt === -1) return { kind: "apply" };
  const upTo = args[baselineAt + 1];
  if (!upTo || !/^\d+$/.test(upTo)) throw new Error("--baseline needs a migration version, e.g. --baseline 20261015000000");
  return { kind: "baseline", upTo };
}

// Connection settings from SUPABASE_DB_URL; ssl options in the URL are dropped so the
// pinned Supabase CA below is what verifies the server (pg lets URL params win otherwise)
function connectionConfig(databaseUrl: string): pg.ClientConfig {
  const url = new URL(databaseUrl);
  for (const param of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(param);
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  return {
    connectionString: url.toString(),
    ssl: isLocal ? false : { ca: readFileSync(SUPABASE_CA_FILE, "utf8") },
  };
}

// Prints what happened, one line per migration (never the connection string)
function printReport(mode: Mode, report: MigrationReport): void {
  const line = (file: MigrationFile) => `  ${file.version}_${file.name}`;
  if (mode.kind === "status") {
    console.log(`Applied (${report.applied.length}):\n${report.applied.map(line).join("\n")}`);
    console.log(`Pending (${report.pending.length}):\n${report.pending.map(line).join("\n")}`);
    return;
  }
  const verb = mode.kind === "baseline" ? "Recorded without running" : "Applied";
  if (report.ran.length === 0) console.log("Database is up to date; nothing to apply.");
  else console.log(`${verb} ${report.ran.length}:\n${report.ran.map(line).join("\n")}`);
}

// Entry point: connect, run, report, and exit non-zero on failure
async function main(): Promise<void> {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) {
    console.error("SUPABASE_DB_URL is not set. Add it to .env.local (see .env.example) or the environment.");
    process.exit(1);
  }
  const mode = parseMode(process.argv.slice(2));
  const client = new pg.Client(connectionConfig(databaseUrl));
  await client.connect();
  try {
    printReport(mode, await runMigrations(client, mode));
  } finally {
    await client.end();
  }
}

// Run only when executed directly (tests import the functions above)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
