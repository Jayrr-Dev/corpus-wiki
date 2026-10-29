import { RENDER_JOB_TIMEOUT_MS } from "./status";

// =====================================================================
// RENDER JOBS on Nebius Serverless AI (CPU). The app starts one job per
// video with our render image (Node, headless Chromium, HyperFrames,
// ffmpeg; scripts/video/render/Dockerfile). The job reads the manifest,
// renders, muxes, uploads the MP4 and poster, then calls back
// POST /api/video/[id]/rendered with a signed token. The VM is billed
// only while the job runs.
// Everything here talks to the RenderJobClient interface; tests pass a
// fake. The Nebius client drives the `nebius` CLI (`nebius ai job ...`)
// through an injected runner, so it never runs in tests either.
// =====================================================================

// What the spike ran (2026-10-29, eu-west1): cpu-d3 is the CPU platform in the regions with CPU quota,
// 8 vCPUs rendered 5.5 s of video in 11 s; Nebius accepts no job timeout under 1 hour
export const RENDER_JOB_DEFAULTS = { platform: "cpu-d3", preset: "8vcpu-32gb", diskGiB: 30, shmGiB: 1, timeoutMinutes: RENDER_JOB_TIMEOUT_MS / 60_000 } as const;

export type RenderJobSpec = {
  name: string;
  image: string;
  // passed to the container as environment variables (the manifest URL and nothing secret-for-long)
  env: Record<string, string>;
  platform?: string;
  preset?: string;
  diskGiB?: number;
  timeoutMinutes?: number;
};

export type RenderJobState = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export type RenderJobStatus = { id: string; state: RenderJobState; logTail: string | null };

export interface RenderJobClient {
  createJob(spec: RenderJobSpec): Promise<{ id: string }>;
  getJob(id: string): Promise<RenderJobStatus>;
}

export class RenderJobError extends Error {}

// Nebius job states, read loosely: the spike (S2) records the exact names
export function jobState(raw: unknown): RenderJobState {
  const value = String(raw ?? "").toLowerCase();
  if (/succe|complet|finished|done/.test(value)) return "succeeded";
  if (/fail|error/.test(value)) return "failed";
  if (/cancel|abort|terminat|delet/.test(value)) return "cancelled";
  if (/run|start/.test(value)) return "running";
  if (/pend|queue|provision|creat|schedul/.test(value)) return "pending";
  return "unknown";
}

export const isJobFinished = (state: RenderJobState) => state === "succeeded" || state === "failed" || state === "cancelled";

// Runs one CLI command and returns its stdout; throws with stderr when it fails
export type CommandRunner = (command: string, args: string[], env: Record<string, string>) => Promise<string>;

export type NebiusJobConfig = {
  // the project the jobs run in (NEBIUS_PROJECT_ID)
  projectId: string;
  // an IAM token for the CLI (NEBIUS_IAM_TOKEN); without it the CLI uses its own profile.
  // It also lets the job pull the private render image (registry user "iam").
  iamToken?: string | null;
  cli?: string;
  run: CommandRunner;
};

const parseJson = (text: string): Record<string, unknown> => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new RenderJobError(`Nebius answered with something other than JSON: ${text.slice(0, 200)}`);
  }
};

const pick = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((at, key) => (at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined), value);

// Last lines of a log, short enough for the Failed screen
export const logTail = (log: string | null | undefined, lines = 20) => (log ? log.trim().split(/\r?\n/).slice(-lines).join("\n") : null);

// THE NEBIUS CLIENT: `nebius ai job create` to start, `ai job get` and `ai job logs` to check
export function nebiusJobClient(config: NebiusJobConfig): RenderJobClient {
  if (!config.projectId) throw new RenderJobError("Add NEBIUS_PROJECT_ID to the server environment to render videos.");
  const cli = config.cli ?? "nebius";
  const env: Record<string, string> = config.iamToken ? { NEBIUS_IAM_TOKEN: config.iamToken } : {};
  return {
    async createJob(spec) {
      const args = [
        "ai", "job", "create",
        "--parent-id", config.projectId,
        "--name", spec.name,
        "--image", spec.image,
        "--platform", spec.platform ?? RENDER_JOB_DEFAULTS.platform,
        "--preset", spec.preset ?? RENDER_JOB_DEFAULTS.preset,
        "--disk-size", `${spec.diskGiB ?? RENDER_JOB_DEFAULTS.diskGiB}Gi`,
        "--shm-size", `${RENDER_JOB_DEFAULTS.shmGiB}Gi`,
        "--timeout", `${spec.timeoutMinutes ?? RENDER_JOB_DEFAULTS.timeoutMinutes}m`,
        // a preemptible VM can be stopped mid-render
        "--on-demand",
        ...(config.iamToken ? ["--registry-username", "iam", "--registry-password", config.iamToken] : []),
        ...Object.entries(spec.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        "--format", "json",
      ];
      const created = parseJson(await config.run(cli, args, env));
      const id = pick(created, "metadata", "id") ?? pick(created, "resource_id") ?? pick(created, "id");
      if (typeof id !== "string" || !id) throw new RenderJobError("Nebius started the job but returned no id.");
      return { id };
    },
    async getJob(id) {
      const job = parseJson(await config.run(cli, ["ai", "job", "get", "--id", id, "--format", "json"], env));
      const state = jobState(pick(job, "status", "state") ?? pick(job, "status", "phase") ?? pick(job, "state"));
      let log: string | null = null;
      if (state === "failed" || state === "cancelled") log = await config.run(cli, ["ai", "job", "logs", id], env).catch(() => null);
      return { id, state, logTail: logTail(log) };
    },
  };
}

// The words shown when a render ends without a callback
export function timeoutMessage(job: RenderJobStatus | null): string {
  if (!job) return "The render did not report back in time.";
  const tail = job.logTail ? `\n${job.logTail}` : "";
  if (job.state === "succeeded") return `The render finished but did not report back.${tail}`;
  if (job.state === "failed") return `The render failed.${tail}`;
  if (job.state === "cancelled") return `The render was stopped before it finished.${tail}`;
  return `The render did not finish within ${RENDER_JOB_DEFAULTS.timeoutMinutes} minutes.${tail}`;
}
