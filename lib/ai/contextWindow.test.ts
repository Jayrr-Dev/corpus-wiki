import { beforeEach, expect, it, vi } from "vitest";
const retrieve = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({ default: class { models = { retrieve }; } }));
import { reviewContextWindow } from "./contextWindow";
beforeEach(() => { retrieve.mockReset(); });

it("uses the reviewer's provider metadata and caches a successful lookup", async () => {
  retrieve.mockResolvedValue({ max_input_tokens: 1_000_000 });
  const settings = { apiKey: "default-key", model: "other/model", roleRoutes: { reviewer: { apiKey: "review-key", model: "anthropic/reviewer-model" } } };
  expect(await reviewContextWindow(settings)).toBe(1_000_000);
  expect(await reviewContextWindow(settings)).toBe(1_000_000);
  expect(retrieve).toHaveBeenCalledTimes(1);
  expect(retrieve).toHaveBeenCalledWith("reviewer-model", {}, expect.any(Object));
});
it("preserves an explicit limit without a provider call", async () => {
  expect(await reviewContextWindow({ apiKey: "test", model: "anthropic/test", contextWindowTokens: 32000 })).toBe(32000);
  expect(retrieve).not.toHaveBeenCalled();
});
it("keeps the conservative limit for unavailable metadata and other providers", async () => {
  retrieve.mockRejectedValue(new Error("Network unavailable"));
  expect(await reviewContextWindow({ apiKey: "fallback", model: "anthropic/unavailable" })).toBe(65536);
  expect(await reviewContextWindow({ apiKey: "test", model: "other/model" })).toBe(65536);
});
it("does not hide upload cancellation as a metadata fallback", async () => {
  const controller = new AbortController();
  retrieve.mockImplementation(async () => { controller.abort(new Error("Cancelled")); throw new Error("Aborted request"); });
  await expect(reviewContextWindow({ apiKey: "cancel", model: "anthropic/cancelled" }, controller.signal)).rejects.toThrow("Cancelled");
  retrieve.mockResolvedValue({ max_input_tokens: 200000 });
  expect(await reviewContextWindow({ apiKey: "cancel", model: "anthropic/cancelled" })).toBe(200000);
});
