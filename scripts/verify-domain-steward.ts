import { readFileSync } from "node:fs";
import { targetFromEnvironment } from "./db/targets.ts";
import { readMigrationFiles, runMigrations } from "./db/migrate.ts";
const target = await targetFromEnvironment(process.env);
try {
  const files = readMigrationFiles().filter((f) => f.version === "20261105100000");
  const test = readFileSync(new URL("../test/db/domain-steward.sql", import.meta.url), "utf8");
  if (process.argv.includes("--rollback")) {
    await target.query(["begin;", readFileSync(files[0]!.path, "utf8"), test.replace(/^begin;/, "").replace(/rollback;\s*$/, ""), "rollback;"].join("\n"));
    console.log("Migration and tests verified together and rolled back; no database update installed.");
  } else {
    if (!process.argv.includes("--install")) throw new Error("Use --rollback for verification or --install to install the migration.");
    const report = await runMigrations(target, { kind: "apply" }, files);
    console.log(`Domain steward migration: ${report.ran.length ? "applied" : "already installed"}`);
    await target.query(test);
  }
  console.log("Domain merge, exact undo, uncertain approval, and later-change protection passed (test changes rolled back).");
} finally { await target.close(); }
