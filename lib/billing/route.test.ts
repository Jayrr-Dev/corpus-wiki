import { beforeEach, describe, expect, it, vi } from "vitest";
import { signPayload } from "./stripe";

// =====================================================================
// POST /api/billing/webhook: a 404 while the billing flag is off, a 400
// for anything unsigned. The flag store and the database are mocks.
// =====================================================================

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), call: vi.fn() }));
vi.mock("@/lib/flags/server", () => ({ isFeatureEnabled: mocks.enabled }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));

import { POST } from "@/app/api/billing/webhook/route";

const SECRET = "whsec_route_test";
const event = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: 1, data: { object: {} } });
const post = (signature?: string) =>
  POST(new Request("http://localhost/api/billing/webhook", { method: "POST", body: event, headers: signature ? { "stripe-signature": signature } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
});

describe("billing webhook route", () => {
  it("is a 404 while the billing flag is off", async () => {
    mocks.enabled.mockResolvedValue(false);
    const t = Math.floor(Date.now() / 1000);
    const response = await post(`t=${t},v1=${signPayload(event, t, SECRET)}`);
    expect(response.status).toBe(404);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("rejects an unsigned request", async () => {
    mocks.enabled.mockResolvedValue(true);
    expect((await post()).status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("accepts a signed one", async () => {
    mocks.enabled.mockResolvedValue(true);
    const t = Math.floor(Date.now() / 1000);
    const response = await post(`t=${t},v1=${signPayload(event, t, SECRET)}`);
    expect(response.status).toBe(200);
  });
});
