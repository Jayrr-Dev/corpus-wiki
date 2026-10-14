import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type MigrationTarget, targetFromEnvironment } from "./targets";

// =====================================================================
// DATABASE MIGRATION RUNNER
// Applies the pending files in supabase/migrations to the project's database,
// over Supabase's HTTPS API (SUPABASE_ACCESS_TOKEN) or a direct Postgres
// connection (SUPABASE_DB_URL). See targets.ts for why there are two.
//
// WHY: schema changes used to go through the Supabase connector, which
// stops for a confirmation on any DROP or DELETE that nobody can answer
// from a thread, so changes stalled. A plain Postgres connection has no
// such prompt, and the same command runs locally and in a Claude session.
//
// HOW: every file is sent as ONE script that opens a transaction, takes an
// advisory lock, records its row in supabase_migrations.schema_migrations
// (the table the Supabase CLI and dashboard use), runs the file and commits.
// One script per file is what lets the HTTPS API (one session per call)
// behave exactly like a direct connection: a file is either fully applied
// and recorded or not at all, and if two runners race, the second waits on
// the lock and then fails on the already-recorded version, changing nothing.
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
const LOCK_SQL = "select pg_advisory_xact_lock(hashtext('second-brain-engine:migrations'));";
const HISTORY_TABLE = "supabase_migrations.schema_migrations";
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
// SQL LITERALS (the HTTPS API takes no bind parameters, so values are inlined)
// =====================================================================

// 'it''s' : a standard single-quoted string literal
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// $migration$...$migration$ with a tag that never occurs in the text, so any SQL survives verbatim
export function dollarQuote(text: string): string {
  let tag = "$migration$";
  for (let n = 1; text.includes(tag); n++) tag = `$migration${n}$`;
  return `${tag}${text}${tag}`;
}

// =====================================================================
// THE HISTORY TABLE (same shape the Supabase CLI creates)
// =====================================================================

// Creates the history table when this database has never had one
async function ensureHistoryTable(target: MigrationTarget): Promise<void> {
  await target.query(
    `create schema if not exists supabase_migrations; create table if not exists ${HISTORY_TABLE} (version text primary key, statements text[], name text);`,
  );
}

// The versions this database has already recorded
async function readAppliedVersions(target: MigrationTarget): Promise<Set<string>> {
  const rows = await target.query<{ version: string }>(`select version from ${HISTORY_TABLE}`);
  return new Set(rows.map((row) => row.version));
}

// The insert that records one file; `statements` is null for a baseline (nothing ran)
function recordVersionSql(file: MigrationFile, statement: string | null): string {
  const statements = statement === null ? "null" : `array[${dollarQuote(statement)}]`;
  return `insert into ${HISTORY_TABLE} (version, name, statements) values (${quoteLiteral(file.version)}, ${quoteLiteral(file.name)}, ${statements});`;
}

// =====================================================================
// APPLYING
// =====================================================================

// Records then runs one file in one script; the record goes first so a racing
// runner fails before running anything. The newline before ";" ends a trailing comment.
export function applyFileScript(file: MigrationFile, sql: string): string {
  return ["begin;", LOCK_SQL, recordVersionSql(file, sql), sql, ";", "commit;"].join("\n");
}

// Runs one file; on any error the database keeps nothing of it
async function applyFile(target: MigrationTarget, file: MigrationFile): Promise<void> {
  const sql = readFileSync(file.path, "utf8");
  try {
    await target.query(applyFileScript(file, sql));
  } catch (error) {
    throw new Error(`Migration ${file.version}_${file.name} failed and was rolled back: ${(error as Error).message}`);
  }
}

// Records every pending file up to `upTo` as applied without running it, in one transaction
async function baselineFiles(target: MigrationTarget, pending: MigrationFile[], upTo: string): Promise<MigrationFile[]> {
  const toRecord = pending.filter((file) => file.version <= upTo);
  if (toRecord.length === 0) return [];
  const inserts = toRecord.map((file) => recordVersionSql(file, null));
  await target.query(["begin;", LOCK_SQL, ...inserts, "commit;"].join("\n"));
  return toRecord;
}

// Brings the database up to date, or reports / baselines, file by file in version order
export async function runMigrations(target: MigrationTarget, mode: Mode, files = readMigrationFiles()): Promise<MigrationReport> {
  await ensureHistoryTable(target);
  const appliedVersions = await readAppliedVersions(target);
  const applied = files.filter((file) => appliedVersions.has(file.version));
  const pending = files.filter((file) => !appliedVersions.has(file.version));

  if (mode.kind === "status") return { applied, pending, ran: [] };
  if (mode.kind === "baseline") return { applied, pending, ran: await baselineFiles(target, pending, mode.upTo) };

  const ran: MigrationFile[] = [];
  for (const file of pending) {
    await applyFile(target, file);
    ran.push(file);
  }
  return { applied, pending, ran };
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

// Prints what happened, one line per migration (never a connection string or token)
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

// Entry point: pick a target, run, report, and exit non-zero on failure
async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const target = await targetFromEnvironment(process.env);
  try {
    printReport(mode, await runMigrations(target, mode));
  } finally {
    await target.close();
  }
}

// Run only when executed directly (tests import the functions above)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
