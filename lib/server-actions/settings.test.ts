import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), call: vi.fn(), agent: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agents/session", () => ({ currentAgentSession: mocks.agent }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));

import { setMonetizationEnabled } from "./settings";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agent.mockReturnValue(null);
  mocks.call.mockResolvedValue({});
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "owner@example.com");
});

it("refuses a signed-in person who is not a platform admin", async () => {
  mocks.requireUser.mockResolvedValue({ id: "q", email: "member@example.com" });
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await setMonetizationEnabled(false)).toEqual({ ok: false, error: "Only a platform admin can change this." });
  } finally { warning.mockRestore(); }
  expect(mocks.call).not.toHaveBeenCalled();
});

it("lets a platform admin change usage-based plans", async () => {
  mocks.requireUser.mockResolvedValue({ id: "p", email: "owner@example.com" });
  expect(await setMonetizationEnabled(true)).toEqual({ ok: true });
  expect(mocks.call).toHaveBeenCalledWith("set_monetization_enabled", { p_enabled: true });
});
