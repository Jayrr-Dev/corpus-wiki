import { spawnSync } from "node:child_process";

// Run from the repository root. No live application or database command is invoked.
const result = spawnSync(process.execPath, [
  "--env-file-if-exists=.env.local", "node_modules/vitest/vitest.mjs", "run",
  "sandbox/sections/run.live.test.ts", "--maxWorkers=1", "--reporter=verbose",
], { stdio: "inherit", env: { ...process.env, RUN_SECTION_SANDBOX: "1", SECTION_SANDBOX_MODEL: process.env.SECTION_SANDBOX_MODEL ?? "zai-org/GLM-5.3-Flash" } });
process.exit(result.status ?? 1);
