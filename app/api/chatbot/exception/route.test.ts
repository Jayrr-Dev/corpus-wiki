import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), answerException: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/server-actions/knowledge", () => ({ answerException: mocks.answerException }));
const decision = { name: "resolve_exception", exceptionId: "00000000-0000-4000-8000-000000000001", accept: true, note: "Confirmed" };
const request = (body: unknown = decision, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/chatbot/exception", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({}); mocks.answerException.mockResolvedValue({ ok: true }); });

describe("exception confirmation endpoint", () => {
  it("requires the same origin and an authenticated user", async () => {
    expect((await POST(request(decision, "https://other.example"))).status).toBe(403);
    mocks.requireUser.mockRejectedValue(new Error("Signed out"));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.answerException).not.toHaveBeenCalled();
  });
  it("validates the decision before calling the existing workflow", async () => {
    expect((await POST(request({ ...decision, exceptionId: "fake" }))).status).toBe(400);
    expect(mocks.answerException).not.toHaveBeenCalled();
    expect((await POST(request())).status).toBe(200);
    expect(mocks.answerException).toHaveBeenCalledWith(decision.exceptionId, true, "Confirmed");
  });
  it("reports workflow failures without claiming success", async () => {
    mocks.answerException.mockResolvedValue({ ok: false, error: "Already resolved" });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Already resolved" });
  });
});
