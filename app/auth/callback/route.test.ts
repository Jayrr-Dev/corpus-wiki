import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { APP_HOME } from "@/lib/auth/paths";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), verify: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verify } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: mocks.clear }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.exchange.mockResolvedValue({ error: null }); mocks.verify.mockResolvedValue({ error: null }); });

it("exchanges a confirmation code and clears the old account's space selection", async () => {
  const response = await GET(new NextRequest("http://localhost:3003/auth/callback?code=test&next=%2Fsettings"));
  expect(mocks.exchange).toHaveBeenCalledWith("test");
  expect(mocks.clear).toHaveBeenCalledWith("second_brain_space");
  expect(response.headers.get("location")).toBe("http://localhost:3003/settings");
});

it("supports email token hashes but prevents redirects to another origin", async () => {
  const response = await GET(new NextRequest("http://localhost:3003/auth/callback?token_hash=test&type=email&next=%2F%5Cevil.example"));
  expect(mocks.verify).toHaveBeenCalledWith({ token_hash: "test", type: "email" });
  expect(response.headers.get("location")).toBe(`http://localhost:3003${APP_HOME}`);
});

it("rejects missing and invalid confirmation credentials", async () => {
  const missing = await GET(new NextRequest("http://localhost:3003/auth/callback"));
  expect(missing.headers.get("location")).toContain("/login?confirmation=failed");
  mocks.verify.mockResolvedValue({ error: new Error("expired") });
  const expired = await GET(new NextRequest("http://localhost:3003/auth/callback?token_hash=old&type=email"));
  expect(expired.headers.get("location")).toContain("/login?confirmation=failed");
  expect(mocks.clear).not.toHaveBeenCalled();
});

it("sends a code opened in another browser to sign-in as confirmed", async () => {
  // Supabase confirmed the address before redirecting; only this browser lacks the sign-up verifier
  mocks.exchange.mockResolvedValue({ error: new Error("code verifier not found") });
  const response = await GET(new NextRequest("http://localhost:3003/auth/callback?code=elsewhere"));
  expect(response.headers.get("location")).toContain("/login?confirmation=signin");
  expect(mocks.clear).not.toHaveBeenCalled();
});
