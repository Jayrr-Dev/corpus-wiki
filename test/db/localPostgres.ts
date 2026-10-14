import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

// =====================================================================
// THROWAWAY POSTGRES 16 FOR TESTS
// Creates a cluster in a fresh /var/tmp dir, listens on a unix socket
// only (no TCP port to collide with), applies the Supabase stubs, the
// migration and the seed, and deletes everything on stop().
// Postgres refuses to run as root, so when tests run as root the server
// commands run as the `postgres` user.
// =====================================================================

// SETTINGS
const PG_BIN = process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin";
const PORT = 5432; // only names the socket file inside the private dir
const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const SQL_FILES = {
  stubs: join(import.meta.dirname, "supabase-stubs.sql"),
  seed: join(REPO_ROOT, "supabase", "seed.sql"),
};

// Every migration, in file-name (timestamp) order, as Supabase applies them
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name));
}

const isRoot = process.getuid?.() === 0;

export type LocalPostgres = {
  // A new client connected as the superuser (bypasses RLS; use `set local role` to test it)
  connect: () => Promise<Client>;
  stop: () => Promise<void>;
};

// True when the Postgres 16 binaries exist (tests skip otherwise)
export function hasLocalPostgres(): boolean {
  return existsSync(join(PG_BIN, "initdb")) && existsSync(join(PG_BIN, "pg_ctl"));
}

// Runs a Postgres binary, as `postgres` when we are root
function runPg(binary: string, args: string[]): void {
  const command = join(PG_BIN, binary);
  if (isRoot) execFileSync("runuser", ["-u", "postgres", "--", command, ...args], { stdio: "pipe" });
  else execFileSync(command, args, { stdio: "pipe" });
}

// Makes the private temp dir and hands it to the postgres user
function makeClusterDir(): string {
  const dir = mkdtempSync("/var/tmp/sb-pg-");
  if (isRoot) execFileSync("chown", ["postgres:postgres", dir]);
  return dir;
}

// Starts the cluster and loads stubs + every migration (+ seed unless told not to)
export async function startLocalPostgres({ withSeed = true } = {}): Promise<LocalPostgres> {
  const dir = makeClusterDir();
  const dataDir = join(dir, "data");
  runPg("initdb", ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-sync"]);
  const serverOptions = `-k ${dir} -p ${PORT} -c listen_addresses= -c fsync=off`;
  runPg("pg_ctl", ["-D", dataDir, "-o", serverOptions, "-l", join(dir, "server.log"), "-w", "start"]);

  const connect = async () => {
    const client = new Client({ host: dir, port: PORT, user: "postgres", database: "postgres" });
    await client.connect();
    return client;
  };
  const stop = async () => {
    runPg("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]);
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    await loadSql(connect, withSeed);
  } catch (error) {
    await stop();
    throw error;
  }
  return { connect, stop };
}

// Applies the SQL files in order on one connection
async function loadSql(connect: () => Promise<Client>, withSeed: boolean): Promise<void> {
  const files = [SQL_FILES.stubs, ...migrationFiles(), ...(withSeed ? [SQL_FILES.seed] : [])];
  const client = await connect();
  try {
    for (const file of files) await client.query(readFileSync(file, "utf8"));
  } finally {
    await client.end();
  }
}
