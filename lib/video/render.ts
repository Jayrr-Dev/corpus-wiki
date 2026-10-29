import { RENDER_JOB_TIMEOUT_MS } from "./status";

// =====================================================================
// RENDER JOBS on Nebius Serverless AI (CPU). The app starts one job per
// video with our render image (Node, headless Chromium, HyperFrames,
// ffmpeg; scripts/video/render/Dockerfile). The job reads the manifest,
// renders, muxes, uploads the MP4 and poster, then calls back
// POST /api/video/[id]/rendered with a signed token. The VM is billed
// only while the job runs.
// Everything here talks to the RenderJobClient interface; tests pass a
// fake. The Nebius client calls the Nebius REST API through an injected
// fetch and token source, so it never reaches the network in tests either.
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

// Nebius job states (JobStatus.State): PROVISIONING, STARTING, IMAGE_PULLING, RUNNING, CANCELLING,
// DELETING, COMPLETED, FAILED, CANCELLED, ERROR; read loosely
export function jobState(raw: unknown): RenderJobState {
  const value = String(raw ?? "").toLowerCase();
  if (/succe|complet|finished|done/.test(value)) return "succeeded";
  if (/fail|error/.test(value)) return "failed";
  if (/cancel|abort|terminat|delet/.test(value)) return "cancelled";
  if (/run/.test(value)) return "running";
  if (/pend|queue|provision|creat|schedul|start|pull/.test(value)) return "pending";
  return "unknown";
}

export const isJobFinished = (state: RenderJobState) => state === "succeeded" || state === "failed" || state === "cancelled";

// The REST gateway in front of the Nebius gRPC API (proto3 JSON: camelCase, int64 as strings, durations as "3600s")
export const NEBIUS_API_URL = "https://api.nebius.cloud";

export type NebiusJobConfig = {
  // the project the jobs run in (NEBIUS_RENDER_PROJECT_ID, else NEBIUS_PROJECT_ID)
  projectId: string;
  // an IAM access token (lib/video/nebius.ts mints them from the service account key).
  // It also lets the job pull the private render image (registry user "iam").
  token: () => Promise<string>;
  fetch?: typeof fetch;
  apiUrl?: string;
};

const pick = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((at, key) => (at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined), value);

// Last lines of a log, short enough for the Failed screen
export const logTail = (log: string | null | undefined, lines = 20) => (log ? log.trim().split(/\r?\n/).slice(-lines).join("\n") : null);

const GIB = 1024 ** 3;

// The CreateJobRequest body for a spec (POST /ai/v1/jobs)
export function jobRequest(projectId: string, spec: RenderJobSpec, registryPassword: string) {
  return {
    metadata: { parentId: projectId, name: spec.name },
    spec: {
      image: spec.image,
      platform: spec.platform ?? RENDER_JOB_DEFAULTS.platform,
      preset: spec.preset ?? RENDER_JOB_DEFAULTS.preset,
      disk: { type: "NETWORK_SSD", sizeBytes: String((spec.diskGiB ?? RENDER_JOB_DEFAULTS.diskGiB) * GIB) },
      shmSizeBytes: String(RENDER_JOB_DEFAULTS.shmGiB * GIB),
      timeout: `${(spec.timeoutMinutes ?? RENDER_JOB_DEFAULTS.timeoutMinutes) * 60}s`,
      // a preemptible VM can be stopped mid-render
      preemptible: false,
      pricingModel: { onDemand: {} },
      registryCredentials: { username: "iam", password: registryPassword },
      environmentVariables: Object.entries(spec.env).map(([name, value]) => ({ name, value })),
    },
  };
}

// THE NEBIUS CLIENT: the Serverless AI JobService over REST (POST /ai/v1/jobs, GET /ai/v1/jobs/{id})
export function nebiusJobClient(config: NebiusJobConfig): RenderJobClient {
  if (!config.projectId) throw new RenderJobError("Add NEBIUS_RENDER_PROJECT_ID (or NEBIUS_PROJECT_ID) to the server environment to render videos.");
  const doFetch = config.fetch ?? fetch;
  const base = (config.apiUrl ?? NEBIUS_API_URL).replace(/\/$/, "");
  const call = async (method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<Record<string, unknown>> => {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // read below
    }
    if (!response.ok) throw new RenderJobError(`Nebius ${method} ${path.split("?")[0]} failed (${response.status}): ${String(pick(json, "message") ?? text).slice(0, 300)}`);
    if (!json) throw new RenderJobError(`Nebius answered with something other than JSON: ${text.slice(0, 200)}`);
    return json;
  };
  return {
    async createJob(spec) {
      const token = await config.token();
      // the answer is the create Operation; the job's id is its resourceId
      const operation = await call("POST", "/ai/v1/jobs", token, jobRequest(config.projectId, spec, token));
      const failed = pick(operation, "status", "code");
      if (typeof failed === "number" && failed !== 0) throw new RenderJobError(`Nebius did not start the job: ${String(pick(operation, "status", "message") ?? `code ${failed}`)}`);
      const id = pick(operation, "resourceId") ?? pick(operation, "metadata", "id");
      if (typeof id !== "string" || !id) throw new RenderJobError("Nebius started the job but returned no id.");
      return { id };
    },
    async getJob(id) {
      const job = await call("GET", `/ai/v1/jobs/${encodeURIComponent(id)}`, await config.token());
      const state = jobState(pick(job, "status", "state"));
      // REST has no log stream; a failed job's state details say why it ended
      const details = state === "failed" || state === "cancelled" ? [pick(job, "status", "stateDetails", "code"), pick(job, "status", "stateDetails", "message")].filter((part) => typeof part === "string" && part).join(": ") : "";
      return { id, state, logTail: logTail(details) };
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
