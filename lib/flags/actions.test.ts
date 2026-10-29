import { beforeEach, expect, it, vi } from "vitest";
import type { FeatureFlagKey } from "./registry";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), call: vi.fn(), agent: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agents/session", () => ({ currentAgentSession: mocks.agent }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));

import { setFeatureFlag } from "./actions";

beforeEach(() => { vi.clearAllMocks(); mocks.agent.mockReturnValue(null); mocks.call.mockResolvedValue({}); });

// Runs an action that is expected to fail, without its error log in the output
async function failing<T>(run: () => Promise<T>): Promise<T> {
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  try { return await run(); } finally { warning.mockRestore(); }
}

it("turns a registered flag on for a signed-in person", async () => {
  expect(await setFeatureFlag("chat_import", true)).toEqual({ ok: true });
  expect(mocks.requireUser).toHaveBeenCalledOnce();
  expect(mocks.call).toHaveBeenCalledWith("set_feature_flag", { p_key: "chat_import", p_enabled: true });
});

it("turns it back off", async () => {
  expect(await setFeatureFlag("chat_import", false)).toEqual({ ok: true });
  expect(mocks.call).toHaveBeenCalledWith("set_feature_flag", { p_key: "chat_import", p_enabled: false });
});

it("refuses a caller who is not signed in", async () => {
  mocks.requireUser.mockRejectedValueOnce(new Error("Not signed in."));
  expect(await failing(() => setFeatureFlag("billing", true))).toEqual({ ok: false, error: "Not signed in." });
  expect(mocks.call).not.toHaveBeenCalled();
});

it("never lets an agent change a flag", async () => {
  mocks.agent.mockReturnValue({ key: { personId: "p" }, spaceId: null });
  expect(await failing(() => setFeatureFlag("billing", true))).toEqual({ ok: false, error: "Agents cannot change feature flags." });
  expect(mocks.call).not.toHaveBeenCalled();
});

it("refuses an unknown key sent from the browser", async () => {
  expect(await failing(() => setFeatureFlag("nope" as FeatureFlagKey, true))).toEqual({ ok: false, error: 'Unknown feature flag "nope".' });
  expect(mocks.call).not.toHaveBeenCalled();
});

it("accepts only registered keys in code", () => {
  // @ts-expect-error: not a registered flag
  void setFeatureFlag.bind(null, "dark_launch");
});
