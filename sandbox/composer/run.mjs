import { spawnSync } from "node:child_process";
const run = spawnSync(process.execPath, ["--env-file-if-exists=.env.local", "node_modules/vitest/vitest.mjs", "run", "sandbox/composer/run.live.test.ts", "--maxWorkers=1", "--reporter=verbose"], { stdio: "inherit", env: { ...process.env, RUN_COMPOSER_SANDBOX: "1" } });
process.exit(run.status ?? 1);
