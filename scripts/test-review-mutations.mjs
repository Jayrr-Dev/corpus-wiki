// Run targeted mutation checks in disposable copies, never in the working source.
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifacts = join(root, "artifacts");
mkdirSync(artifacts, { recursive: true });
const temporary = mkdtempSync(join(artifacts, "review-mutations-"));
const source = join(root, "lib", "living-page");
try {
  for (const file of ["fragmentReview.ts", "fragmentReview.test.ts", "reviewContext.ts", "pageReview.ts"]) copyFileSync(join(source, file), join(temporary, file));
  const config = join(temporary, "vitest.config.mjs");
  writeFileSync(config, `export default ${JSON.stringify({ root: temporary, resolve: { alias: { "@": root, "server-only": join(root, "test", "server-only.ts") } }, test: { include: ["fragmentReview.test.ts"], environment: "node" } })};`);
  const original = readFileSync(join(temporary, "fragmentReview.ts"), "utf8");
  const run = () => spawnSync(process.execPath, [join(root, "node_modules", "vitest", "vitest.mjs"), "run", "--config", config], { cwd: root, encoding: "utf8" });
  const baseline = run();
  if (baseline.status !== 0) throw new Error(`Isolated baseline failed:\n${baseline.stdout}\n${baseline.stderr}`);
  console.log("Isolated baseline passed.");
  const mutations = [
    { name: "accept fabricated or unseen quotations", before: 'if (!record || typeof text !== "string" || !text.includes(reference.quote) || !fragments.some((fragment) => fragment.kind === reference.kind && fragment.recordIndex === reference.recordIndex && fragment.text.includes(escaped)))', after: "if (false)", expectedFailure: "fails closed for fabricated" },
    { name: "skip evidence consolidation entirely", before: 'observations.filter((item) => item.kind === "lines")', after: "observations.filter(() => false)", expectedFailure: "consolidates quotations from separate packets" },
  ];
  for (const mutation of mutations) {
    if (!original.includes(mutation.before)) throw new Error(`Mutation target changed: ${mutation.name}`);
    writeFileSync(join(temporary, "fragmentReview.ts"), original.replace(mutation.before, mutation.after));
    const result = run();
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || !output.includes(mutation.expectedFailure) || !output.includes("AssertionError")) throw new Error(`Mutation was not caught by the expected assertion: ${mutation.name}\n${output}`);
    console.log(`Caught regression: ${mutation.name}`);
  }
} finally {
  // The deletion target is the unique directory created above, inside artifacts.
  if (resolve(temporary).startsWith(resolve(artifacts) + "\\") || resolve(temporary).startsWith(resolve(artifacts) + "/")) rmSync(temporary, { recursive: true, force: true });
}
