import { spawnSync } from "node:child_process";
const synthetic = process.argv.includes("--synthetic");
const files = ["test/performance/processing.bench.test.ts", ...(synthetic ? [
  "test/performance/syntheticUpload.test.ts", "lib/living-page/rebuildAfterEvent.test.ts", "lib/living-page/rebuildSection.test.ts", "lib/ingest/workflow.test.ts", "lib/glossary/generate.test.ts",
  "lib/knowledge/entityProfiles.test.ts", "lib/knowledge/entityWeb.test.ts", "lib/knowledge/embeddingStore.test.ts",
  "lib/ai/embeddings.test.ts", "lib/processing/concurrency.test.ts", "lib/processing/recovery.test.ts", "test/db/processingRecovery.test.ts",
] : [])];
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...files, "--maxWorkers=2"], {
  stdio: "inherit", env: { ...process.env, PROCESSING_BENCHMARK: "1", ...(synthetic ? { PROCESSING_SYNTHETIC: "1" } : {}) },
});
process.exit(result.status ?? 1);
