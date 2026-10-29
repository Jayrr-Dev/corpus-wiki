import { describe, expect, it } from "vitest";
import { isJobFinished, jobState, logTail, nebiusJobClient, RENDER_JOB_DEFAULTS, RenderJobError, timeoutMessage } from "./render";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

// A fetch that answers from a table keyed by "METHOD path" and records each request (no network)
function fakeFetch(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${new URL(url).pathname}`] ?? { status: 404, body: { message: "not found" } };
    return new Response(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const token = async () => "iam-token";
const client = (fetch: typeof globalThis.fetch) => nebiusJobClient({ projectId: "project-1", token, fetch });
const spec = { name: "video-1", image: "cr.example/render:1", env: { MANIFEST_URL: "https://m" } };

describe("Nebius render jobs", () => {
  it("creates an on-demand CPU job with the spike's platform, preset, disk, shm and timeout", async () => {
    const { fetch, calls } = fakeFetch({ "POST /ai/v1/jobs": { body: { id: "op-1", resourceId: "aijob-1", status: null } } });
    expect(await client(fetch).createJob(spec)).toEqual({ id: "aijob-1" });
    const { url, method, headers, body } = calls[0]!;
    expect([method, url]).toEqual(["POST", "https://api.nebius.cloud/ai/v1/jobs"]);
    expect(headers.Authorization).toBe("Bearer iam-token");
    expect(RENDER_JOB_DEFAULTS.platform).toBe("cpu-d3");
    expect(body).toEqual({
      metadata: { parentId: "project-1", name: "video-1" },
      spec: {
        image: "cr.example/render:1",
        platform: "cpu-d3",
        preset: "8vcpu-32gb",
        disk: { type: "NETWORK_SSD", sizeBytes: String(30 * 1024 ** 3) },
        shmSizeBytes: String(1024 ** 3),
        timeout: "3600s",
        preemptible: false,
        pricingModel: { onDemand: {} },
        registryCredentials: { username: "iam", password: "iam-token" },
        environmentVariables: [{ name: "MANIFEST_URL", value: "https://m" }],
      },
    });
  });

  it("fails clearly when Nebius refuses, returns no id or no JSON", async () => {
    await expect(client(fakeFetch({ "POST /ai/v1/jobs": { status: 403, body: { code: 7, message: "permission denied" } } }).fetch).createJob(spec)).rejects.toThrow("(403): permission denied");
    await expect(client(fakeFetch({ "POST /ai/v1/jobs": { body: { status: { code: 8, message: "quota exceeded" } } } }).fetch).createJob(spec)).rejects.toThrow("quota exceeded");
    await expect(client(fakeFetch({ "POST /ai/v1/jobs": { body: {} } }).fetch).createJob(spec)).rejects.toThrow(RenderJobError);
    await expect(client(fakeFetch({ "POST /ai/v1/jobs": { body: "oops" } }).fetch).createJob(spec)).rejects.toThrow("JSON");
  });

  it("reads a job's state, and why it failed", async () => {
    const { fetch, calls } = fakeFetch({ "GET /ai/v1/jobs/aijob-1": { body: { metadata: { id: "aijob-1" }, status: { state: "FAILED", stateDetails: { code: "ContainerExited", message: "exit code 137" } } } } });
    expect(await client(fetch).getJob("aijob-1")).toEqual({ id: "aijob-1", state: "failed", logTail: "ContainerExited: exit code 137" });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["GET https://api.nebius.cloud/ai/v1/jobs/aijob-1"]);
    expect(calls[0]!.headers.Authorization).toBe("Bearer iam-token");
  });

  it("reads the live states of a job as it starts and finishes", async () => {
    const states = ["PROVISIONING", "STARTING", "IMAGE_PULLING", "RUNNING", "COMPLETED"];
    const seen = [];
    for (const state of states) seen.push((await client(fakeFetch({ "GET /ai/v1/jobs/j": { body: { status: { state } } } }).fetch).getJob("j")).state);
    expect(seen).toEqual(["pending", "pending", "pending", "running", "succeeded"]);
  });

  it("needs a project", () => {
    expect(() => nebiusJobClient({ projectId: "", token })).toThrow("NEBIUS_RENDER_PROJECT_ID");
  });

  it("reads job states loosely", () => {
    expect(["SUCCEEDED", "COMPLETED", "FAILED", "CANCELLED", "RUNNING", "PROVISIONING", "PENDING", "???"].map(jobState)).toEqual(["succeeded", "succeeded", "failed", "cancelled", "running", "pending", "pending", "unknown"]);
    expect(["succeeded", "failed", "cancelled"].every((state) => isJobFinished(state as never))).toBe(true);
    expect(isJobFinished("running")).toBe(false);
  });

  it("keeps the last lines of a log", () => {
    expect(logTail(Array.from({ length: 30 }, (_, index) => `l${index}`).join("\n"), 2)).toBe("l28\nl29");
    expect(logTail(null)).toBeNull();
  });

  it("explains a missing callback in plain words", () => {
    expect(timeoutMessage(null)).toBe("The render did not report back in time.");
    expect(timeoutMessage({ id: "j", state: "succeeded", logTail: null })).toBe("The render finished but did not report back.");
    expect(timeoutMessage({ id: "j", state: "failed", logTail: "oom" })).toBe("The render failed.\noom");
    expect(timeoutMessage({ id: "j", state: "running", logTail: null })).toBe("The render did not finish within 60 minutes.");
  });
});
