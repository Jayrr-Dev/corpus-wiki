import { spawnSync } from "node:child_process";
// This command is deliberately separate from offline benchmarks and normal tests.
if (!process.env.NEBIUS_API_KEY || !process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("The live test requires the app's AI and Supabase server settings.");
}
const resumeIndex = process.argv.indexOf("--resume");
const resumePath = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : undefined;
if (resumeIndex >= 0 && !resumePath) throw new Error("Supply the saved report.json path after --resume.");
const scenariosIndex = process.argv.indexOf("--synthetic-projects");
const scenarioCount = scenariosIndex >= 0 ? Number(process.argv[scenariosIndex + 1]) : 0;
const small = process.argv.includes("--small");
if (small && scenarioCount) throw new Error("Choose --small or --synthetic-projects, not both.");
if (!Number.isInteger(scenarioCount) || scenarioCount < 0 || scenarioCount > 4) throw new Error("Use --synthetic-projects with a count from 1 to 4.");
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "test/performance/utilitekLive.test.ts", "--maxWorkers=1"], {
  stdio: "inherit", env: { ...process.env, PROCESSING_LIVE_UTILITEK: "1", PROCESSING_UTILITEK_SMALL: small ? "1" : "0", PROCESSING_UTILITEK_SCENARIOS: String(scenarioCount), ...(resumePath ? { PROCESSING_UTILITEK_RESUME: resumePath } : {}) },
});
process.exit(result.status ?? 1);
