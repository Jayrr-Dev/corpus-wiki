import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// =====================================================================
// MIGRATION TARGETS
// The two ways the runner can reach the database. Both take one SQL script
// and return the rows of its last statement, so the runner does not care
// which one it has.
//
// WHY TWO: a direct Postgres connection works on a developer machine, but
// Claude's cloud sessions only pass HTTPS traffic, so Postgres connections
// never leave the container. Supabase's Management API runs the same SQL
// over HTTPS, so it works from both.
// =====================================================================

// TYPES
export type MigrationTarget = {
  // Runs one script (it may hold several statements) and returns its last statement's rows
  query<Row = Record<string, unknown>>(sql: string): Promise<Row[]>;
  close(): Promise<void>;
};

// SETTINGS
const REPO_ROOT = join(import.meta.dirname, "..", "..");
// Supabase's public root CA, so the connection is verified, not just encrypted
const SUPABASE_CA_FILE = join(REPO_ROOT, "supabase", "certs", "prod-ca-2021.crt");
const MANAGEMENT_API = "https://api.supabase.com/v1";

// =====================================================================
// DIRECT POSTGRES (SUPABASE_DB_URL)
// =====================================================================

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

// Wraps an open pg client; a failed script leaves its transaction aborted, so roll it back
export function postgresTarget(client: pg.Client): MigrationTarget {
  return {
    async query<Row>(sql: string): Promise<Row[]> {
      try {
        const result = await client.query(sql);
        // A multi-statement script returns one result per statement; keep the last
        const last = Array.isArray(result) ? result.at(-1) : result;
        return (last?.rows ?? []) as Row[];
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    },
    close: () => client.end(),
  };
}

// Opens a direct connection from SUPABASE_DB_URL
export async function connectPostgres(databaseUrl: string): Promise<MigrationTarget> {
  const client = new pg.Client(connectionConfig(databaseUrl));
  await client.connect();
  return postgresTarget(client);
}

// =====================================================================
// SUPABASE MANAGEMENT API (SUPABASE_ACCESS_TOKEN, over HTTPS)
// =====================================================================

// "https://abcd.supabase.co" -> "abcd": the project ref comes from the app's own URL setting
export function projectRefFromUrl(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  if (!ref) throw new Error(`Cannot read a project ref from ${supabaseUrl}`);
  return ref;
}

// Each call is its own session, so a script must carry its own begin/commit
export function managementApiTarget(projectRef: string, accessToken: string): MigrationTarget {
  return {
    async query<Row>(sql: string): Promise<Row[]> {
      const response = await fetch(`${MANAGEMENT_API}/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = (body as { message?: string } | null)?.message ?? response.statusText;
        throw new Error(`Supabase API ${response.status}: ${message}`);
      }
      return (Array.isArray(body) ? body : []) as Row[];
    },
    close: async () => undefined,
  };
}

// =====================================================================
// CHOOSING A TARGET FROM THE ENVIRONMENT
// =====================================================================

// The access token wins because it works everywhere; the database URL is the local fallback
export async function targetFromEnvironment(env: NodeJS.ProcessEnv): Promise<MigrationTarget> {
  if (env.SUPABASE_ACCESS_TOKEN) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("SUPABASE_ACCESS_TOKEN needs NEXT_PUBLIC_SUPABASE_URL to name the project.");
    return managementApiTarget(projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL), env.SUPABASE_ACCESS_TOKEN);
  }
  if (env.SUPABASE_DB_URL) return connectPostgres(env.SUPABASE_DB_URL);
  throw new Error("Set SUPABASE_ACCESS_TOKEN or SUPABASE_DB_URL in .env.local (see .env.example) or the environment.");
}
