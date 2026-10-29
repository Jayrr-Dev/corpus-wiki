import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SPIKE = resolve("scripts/video/spike.ts");
const CREDENTIALS = ["ELEVENLABS_API_KEY", "NEBIUS_RENDER_PROJECT_ID", "NEBIUS_PROJECT_ID", "NEBIUS_SERVICE_ACCOUNT_ID", "NEBIUS_PUBLIC_KEY_ID", "NEBIUS_PRIVATE_KEY_PATH", "NEBIUS_PRIVATE_KEY", "NEBIUS_IAM_TOKEN", "VIDEO_RENDER_IMAGE", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"];

// Runs the spike in an empty folder (no .env.local) with only the given credentials set
function runSpike(set: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !CREDENTIALS.includes(key)) env[key] = value;
  // The flag lets Node 22.14 run .ts; newer Node accepts it as a no-op
  return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SPIKE], { cwd: mkdtempSync(join(tmpdir(), "video-spike-")), env: { ...env, ...set } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 });
}

describe("video spike", () => {
  it("exits 1 at once, naming every missing credential, when none is set", () => {
    const result = runSpike({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Video spike not run: credentials are missing. Nothing was called and nothing was spent.");
    for (const name of CREDENTIALS.filter((name) => name !== "NEBIUS_IAM_TOKEN")) expect(result.stderr).toContain(name);
    expect(result.stderr).not.toContain("NEBIUS_IAM_TOKEN");
  });

  it("names only what is still missing", () => {
    const result = runSpike({ ELEVENLABS_API_KEY: "set", NEBIUS_PROJECT_ID: "set", NEBIUS_SERVICE_ACCOUNT_ID: "set", NEBIUS_PUBLIC_KEY_ID: "set", NEBIUS_PRIVATE_KEY: "set" });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("ELEVENLABS_API_KEY");
    // one of each "A or B" pair is enough
    expect(result.stderr).not.toContain("NEBIUS_PROJECT_ID");
    expect(result.stderr).not.toContain("NEBIUS_PRIVATE_KEY");
    expect(result.stderr).toContain("VIDEO_RENDER_IMAGE");
    expect(result.stderr).toContain("SUPABASE_SECRET_KEY");
  });
});
