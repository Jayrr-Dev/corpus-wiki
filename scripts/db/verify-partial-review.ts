import { readFileSync } from "node:fs";
import { join } from "node:path";
import { targetFromEnvironment } from "./targets.ts";
import { readMigrationFiles, runMigrations } from "./migrate.ts";

const root = join(import.meta.dirname, "..", "..");
const file = readMigrationFiles().find((file) => file.version === "20261105160000");
if (!file) throw new Error("Coverage migration is missing.");
const migration = readFileSync(file.path, "utf8");
const previous = readFileSync(join(root, "supabase/migrations/20261105140000_page_review_content_hash.sql"), "utf8");
const body = (text: string) => text.slice(text.indexOf("create or replace function public.complete_page_review")).match(/as \$\$([\s\S]*?)\$\$/)?.[1]?.trim();
const target = await targetFromEnvironment(process.env);
try {
  const rows = await target.query<{ prosrc: string }>("select prosrc from pg_proc where oid='public.complete_page_review(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure");
  if (rows[0]?.prosrc.trim() !== body(previous) && rows[0]?.prosrc.trim() !== body(migration)) throw new Error("The database review function differs from the expected version; refusing to overwrite it.");
  await target.query("begin; set local lock_timeout='5s'; set local statement_timeout='30s';\n" + migration + "\n" + readFileSync(join(root, "test/db/partial-review-coverage.sql"), "utf8") + "\nrollback;");
  console.log("Database coverage checks passed; all test changes rolled back.");
  if (process.argv.includes("--apply")) {
    const report = await runMigrations(target, { kind: "apply" }, [file]);
    console.log(`Coverage migration applied: ${report.ran.length}; no other migrations selected.`);
  }
} finally { await target.close(); }
