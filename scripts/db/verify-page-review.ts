import { readFileSync } from "node:fs";
import { readMigrationFiles, runMigrations } from "./migrate.ts";
import { targetFromEnvironment } from "./targets.ts";

const target = await targetFromEnvironment(process.env);
try {
  const files = readMigrationFiles().filter((file) => ["20261105110000", "20261105120000", "20261105130000", "20261105140000", "20261105150000"].includes(file.version));
  const report = await runMigrations(target, { kind: "apply" }, files);
  console.log(`Applied ${report.ran.length} page reviewer migrations.`);
  await target.query(readFileSync(new URL("../../test/db/page-review.sql", import.meta.url), "utf8"));
  console.log("Page reviewer database checks passed (rolled back test data).");
} finally {
  await target.close();
}
