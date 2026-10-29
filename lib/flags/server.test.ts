import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ call: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); }) }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
// Outside a React Server Component render `cache` does not memoize; pass the function through
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T>(fn: T) => fn }));

import { getFeatureFlags, isFeatureEnabled, requireFeature } from "./server";

beforeEach(() => { vi.clearAllMocks(); });

// Runs a read that is expected to log its failure, without the log in the output
async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { return await run(); } finally { log.mockRestore(); }
}

it("is off when the flag has no row", async () => {
  mocks.call.mockResolvedValue({});
  expect(await isFeatureEnabled("billing")).toBe(false);
  expect(mocks.call).toHaveBeenCalledWith("get_feature_flags");
});

it("is on only when the saved value is true", async () => {
  mocks.call.mockResolvedValue({ billing: true, legal_pages: "true" });
  expect(await isFeatureEnabled("billing")).toBe(true);
  expect(await isFeatureEnabled("legal_pages")).toBe(false);
});

it("fails closed when the database cannot be read", async () => {
  mocks.call.mockRejectedValue(new Error("Connection terminated unexpectedly"));
  expect(await quiet(() => isFeatureEnabled("gmail_import"))).toBe(false);
});

it("lets Settings see a read failure instead of hiding it", async () => {
  mocks.call.mockRejectedValue(new Error("Connection terminated unexpectedly"));
  await expect(getFeatureFlags()).rejects.toThrow("Connection terminated unexpectedly");
});

it("answers 404 for a route behind a flag that is off, and nothing when it is on", async () => {
  mocks.call.mockResolvedValue({});
  await expect(requireFeature("audio_ingest")).rejects.toThrow("404");
  expect(mocks.notFound).toHaveBeenCalledOnce();
  mocks.call.mockResolvedValue({ audio_ingest: true });
  await expect(requireFeature("audio_ingest")).resolves.toBeUndefined();
  expect(mocks.notFound).toHaveBeenCalledOnce();
});

it("accepts only registered keys", () => {
  // @ts-expect-error: not a registered flag
  void isFeatureEnabled.bind(null, "dark_launch");
  // @ts-expect-error: not a registered flag
  void requireFeature.bind(null, "dark_launch");
});
