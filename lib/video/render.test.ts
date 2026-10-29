import { describe, expect, it } from "vitest";
import { type CommandRunner, isJobFinished, jobState, logTail, nebiusJobClient, RENDER_JOB_DEFAULTS, RenderJobError, timeoutMessage } from "./render";

// A runner that answers from a table and records each command (the CLI never runs)
function fakeRunner(answers: Record<string, string | Error>) {
  const calls: { command: string; args: string[]; env: Record<string, string> }[] = [];
  const run: CommandRunner = async (command, args, env) => {
    calls.push({ command, args, env });
    const answer = answers[args.slice(0, 3).join(" ")];
    if (answer instanceof Error) throw answer;
    return answer ?? "";
  };
  return { run, calls };
}

describe("Nebius render jobs", () => {
  it("creates an on-demand CPU job with the spike's platform, preset, disk and timeout", async () => {
    const { run, calls } = fakeRunner({ "ai job create": JSON.stringify({ metadata: { id: "aijob-1" } }) });
    const client = nebiusJobClient({ projectId: "project-1", iamToken: "iam", run });
    expect(await client.createJob({ name: "video-1", image: "cr.example/render:1", env: { MANIFEST_URL: "https://m" } })).toEqual({ id: "aijob-1" });
    const { command, args, env } = calls[0]!;
    expect(command).toBe("nebius");
    expect(env).toEqual({ NEBIUS_IAM_TOKEN: "iam" });
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(flag("--parent-id")).toBe("project-1");
    expect(flag("--image")).toBe("cr.example/render:1");
    expect(flag("--platform")).toBe(RENDER_JOB_DEFAULTS.platform);
    expect(flag("--platform")).toBe("cpu-d3");
    expect(flag("--preset")).toBe("8vcpu-32gb");
    expect(flag("--disk-size")).toBe("30Gi");
    expect(flag("--shm-size")).toBe("1Gi");
    expect(flag("--timeout")).toBe("60m");
    expect(args).toContain("--on-demand");
    expect(flag("--registry-username")).toBe("iam");
    expect(flag("--registry-password")).toBe("iam");
    expect(flag("--env")).toBe("MANIFEST_URL=https://m");
  });

  it("leaves out registry credentials when it has no token", async () => {
    const { run, calls } = fakeRunner({ "ai job create": JSON.stringify({ metadata: { id: "aijob-2" } }) });
    await nebiusJobClient({ projectId: "project-1", run }).createJob({ name: "v", image: "i", env: {} });
    expect(calls[0]!.args).not.toContain("--registry-password");
  });

  it("fails clearly when Nebius returns no id or no JSON", async () => {
    await expect(nebiusJobClient({ projectId: "p", run: fakeRunner({ "ai job create": "{}" }).run }).createJob({ name: "n", image: "i", env: {} })).rejects.toThrow(RenderJobError);
    await expect(nebiusJobClient({ projectId: "p", run: fakeRunner({ "ai job create": "oops" }).run }).createJob({ name: "n", image: "i", env: {} })).rejects.toThrow("JSON");
  });

  it("reads a job's state, and its log tail when it failed", async () => {
    const { run, calls } = fakeRunner({ "ai job get": JSON.stringify({ status: { state: "FAILED" } }), "ai job logs": "a\nb\nOut of memory" });
    expect(await nebiusJobClient({ projectId: "p", run }).getJob("aijob-1")).toEqual({ id: "aijob-1", state: "failed", logTail: "a\nb\nOut of memory" });
    expect(calls.map((call) => call.args.slice(0, 3).join(" "))).toEqual(["ai job get", "ai job logs"]);
  });

  it("does not fetch logs for a running job", async () => {
    const { run, calls } = fakeRunner({ "ai job get": JSON.stringify({ status: { state: "RUNNING" } }) });
    expect((await nebiusJobClient({ projectId: "p", run }).getJob("j")).state).toBe("running");
    expect(calls).toHaveLength(1);
  });

  it("needs a project", () => {
    expect(() => nebiusJobClient({ projectId: "", run: async () => "" })).toThrow("NEBIUS_PROJECT_ID");
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
