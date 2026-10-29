import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// BILLING ACTIONS: a 404 while the flag is off; with it on, Checkout and
// the portal go to a mocked fetch, so nothing reaches Stripe.
// =====================================================================

const NOT_FOUND = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
const mocks = vi.hoisted(() => ({ requireFeature: vi.fn(), requireUser: vi.fn(), agent: vi.fn(), call: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/flags/server", () => ({ requireFeature: mocks.requireFeature }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agents/session", () => ({ currentAgentSession: mocks.agent }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => (name === "origin" ? mocks.origin() : null) }) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: (error: unknown) => { if (error === NOT_FOUND) throw error; } }));

import { openBillingPortal, startCheckout } from "./actions";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_only");
  vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
  vi.stubEnv("STRIPE_PRICE_TEAM_MONTHLY", "price_team");
  mocks.requireFeature.mockResolvedValue(undefined);
  mocks.requireUser.mockResolvedValue({ id: "user-1", email: "a@example.com" });
  mocks.agent.mockReturnValue(null);
  mocks.origin.mockReturnValue("https://app.test");
  mocks.call.mockResolvedValue({ planId: "free", status: "active", customerId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try { return await run(); } finally { spy.mockRestore(); }
}

describe("startCheckout", () => {
  it("is a 404 while the billing flag is off", async () => {
    mocks.requireFeature.mockRejectedValue(NOT_FOUND);
    await expect(startCheckout("pro")).rejects.toBe(NOT_FOUND);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a Checkout URL for a paid plan", async () => {
    expect(await startCheckout("pro", "month")).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_1" });
    const params = new URLSearchParams(String(fetchMock.mock.calls[0]![1]!.body));
    expect(params.get("line_items[0][price]")).toBe("price_pro_m");
    expect(params.get("success_url")).toBe("https://app.test/settings?billing=done");
  });

  it("buys at least the Team seat minimum", async () => {
    await startCheckout("team", "month", 1);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0]![1]!.body)).get("line_items[0][quantity]")).toBe("3");
  });

  it("refuses Free, a missing price and agents", async () => {
    expect(await quietly(() => startCheckout("free"))).toEqual({ ok: false, error: "Choose a paid plan." });
    expect(await quietly(() => startCheckout("max"))).toMatchObject({ ok: false });
    mocks.agent.mockReturnValue({ key: { personId: "user-1" } });
    expect(await quietly(() => startCheckout("pro"))).toEqual({ ok: false, error: "Agents cannot change billing." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("openBillingPortal", () => {
  it("needs a Stripe customer first", async () => {
    expect(await quietly(() => openBillingPortal())).toEqual({ ok: false, error: "No paid plan yet." });
  });

  it("opens the portal for a paying person", async () => {
    mocks.call.mockResolvedValue({ planId: "pro", status: "active", customerId: "cus_1" });
    expect(await openBillingPortal()).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_1" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.stripe.com/v1/billing_portal/sessions");
  });
});
