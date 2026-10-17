import { beforeEach, it, expect, vi } from "vitest";
import { GET } from "./route";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: vi.fn() }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: vi.fn() }));
const call = vi.fn();
it("resolves reused raster assets from the library instead of invented image URLs", async () => {
  call.mockResolvedValueOnce({ id: runId, composition: { figures: [{ svg: "", assetId: pageId }] } });
  const single = vi.fn().mockResolvedValue({ data: { id: pageId, origin: "external", media_url: "https://example.com/logo.png" } });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single };
  vi.mocked(getAdminSupabase).mockReturnValue({ from: vi.fn().mockReturnValue(query) } as unknown as ReturnType<typeof getAdminSupabase>);
  const response = await GET(new Request("http://localhost"), context);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://example.com/logo.png");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
const pageId = "10000000-0000-4000-8000-000000000001";
const runId = "10000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ pageId, runId, index: "0" }) };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(supabaseRpc).mockReturnValue({ call }); });
it("requires sign-in before any illustration read", async () => {
  vi.mocked(requireUser).mockRejectedValueOnce(new Error("Not signed in"));
  expect((await GET(new Request("http://localhost"), context)).status).toBe(401);
  expect(call).not.toHaveBeenCalled();
});
it("does not serve a retired or mismatched run", async () => {
  call.mockResolvedValueOnce({ id: pageId });
  expect((await GET(new Request("http://localhost"), context)).status).toBe(404);
});
it("rejects active SVG content and serves inert SVG with private security headers", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="10" height="10"/></svg>';
  call.mockResolvedValueOnce({ id: runId, composition: { figures: [{ svg: svg.replace('</svg>', '<script>bad()</script></svg>') }] } });
  expect((await GET(new Request("http://localhost"), context)).status).toBe(404);
  call.mockResolvedValueOnce({ id: runId, composition: { figures: [{ svg }] } });
  const response = await GET(new Request("http://localhost"), context);
  expect(await response.text()).toBe(svg);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
});
