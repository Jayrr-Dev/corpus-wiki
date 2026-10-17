import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), call: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
import { POST } from "./route";

const id = "00000000-0000-4000-8000-5e0000000001";
const request = () => new Request(`http://localhost:3000/api/sections/${id}/cancel`, { method: "POST" });
describe("cancel section route", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it("cancels a signed-in user's section independently of the rewrite action", async () => {
    expect((await POST(request(), { params: Promise.resolve({ sectionId: id }) })).status).toBe(200);
    expect(mocks.call).toHaveBeenCalledWith("cancel_section_build", { p_section_id: id });
  });
  it("requires authentication", async () => {
    mocks.requireUser.mockRejectedValue(new Error("Not signed in"));
    expect((await POST(request(), { params: Promise.resolve({ sectionId: id }) })).status).toBe(401);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("rejects invalid section IDs", async () => {
    expect((await POST(request(), { params: Promise.resolve({ sectionId: "invalid" }) })).status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests", async () => {
    const req = new Request(request(), { headers: { origin: "https://other.example" } });
    expect((await POST(req, { params: Promise.resolve({ sectionId: id }) })).status).toBe(403);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("returns a failure when cancellation could not be saved", async () => {
    mocks.call.mockRejectedValue(new Error("Database unavailable"));
    const response = await POST(request(), { params: Promise.resolve({ sectionId: id }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false });
  });
});
