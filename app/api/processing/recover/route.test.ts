import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/processing/recovery", () => ({ runScheduledRecovery: vi.fn(async () => true) }));
import { runScheduledRecovery } from "@/lib/processing/recovery";
import { POST } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("rejects unconfigured and unauthorized schedulers without claiming any work", async () => {
  vi.stubEnv("PROCESSING_WORKER_KEY", "");
  expect((await POST(new Request("https://example.test/api/processing/recover"))).status).toBe(503);
  vi.stubEnv("PROCESSING_WORKER_KEY", "worker-secret");
  expect((await POST(new Request("https://example.test/api/processing/recover"))).status).toBe(401);
  expect((await POST(new Request("https://example.test/api/processing/recover", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  expect(runScheduledRecovery).not.toHaveBeenCalled();
});
it("runs one bounded continuation for a scheduler with the dedicated worker key", async () => {
  vi.stubEnv("PROCESSING_WORKER_KEY", "worker-secret");
  const response = await POST(new Request("https://example.test/api/processing/recover", { headers: { authorization: "Bearer worker-secret" } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ worked: true });
  expect(runScheduledRecovery).toHaveBeenCalledOnce();
});
