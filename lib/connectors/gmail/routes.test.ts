import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealTokens, tokenKeyFrom } from "./crypto";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(async () => true),
  requireUser: vi.fn(async () => ({ id: "person-1", email: null })),
  completeConnect: vi.fn(async () => ({ accountEmail: "me@example.com" })),
}));
vi.mock("@/lib/flags/server", () => ({ isFeatureEnabled: mocks.enabled }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("./server", async (original) => ({
  ...(await original<typeof import("./server")>()),
  serverGmailService: () => ({ completeConnect: mocks.completeConnect }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));

import { ATTEMPT_COOKIE, handleCallback, handleConnect } from "./routes";

const KEY_TEXT = Buffer.alloc(32, 9).toString("base64");
const ENV = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", GMAIL_TOKEN_KEY: KEY_TEXT };

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  vi.stubEnv("GOOGLE_REDIRECT_URI", "");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("flag off", () => {
  it("both routes are a 404 and do nothing", async () => {
    mocks.enabled.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    const connect = await handleConnect(new NextRequest("http://localhost:3000/api/gmail/connect"));
    const callback = await handleCallback(new NextRequest("http://localhost:3000/api/gmail/callback?code=c&state=s"));
    expect(connect.status).toBe(404);
    expect(callback.status).toBe(404);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.completeConnect).not.toHaveBeenCalled();
  });
});

describe("connect", () => {
  it("redirects to Google with read-only scope and a sealed attempt cookie", async () => {
    const response = await handleConnect(new NextRequest("http://localhost:3000/api/gmail/connect"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.host).toBe("accounts.google.com");
    expect(location.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/gmail/callback");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${ATTEMPT_COOKIE}=v1.`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).not.toContain("csecret");
  });

  it("needs a signed-in person", async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error("Not signed in."));
    expect((await handleConnect(new NextRequest("http://localhost:3000/api/gmail/connect"))).status).toBe(401);
  });

  it("sends the person back to Settings when the env is missing", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const response = await handleConnect(new NextRequest("http://localhost:3000/api/gmail/connect"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/settings?gmail=setup#gmail");
  });
});

describe("callback", () => {
  const cookieFor = (state: string, personId = "person-1", createdAt = Date.now()) => sealTokens(tokenKeyFrom(KEY_TEXT), personId, { state, verifier: "ver-1", createdAt });
  const callback = (query: string, cookie?: string) => {
    const request = new NextRequest(`http://localhost:3000/api/gmail/callback?${query}`);
    if (cookie) request.cookies.set(ATTEMPT_COOKIE, cookie);
    return handleCallback(request);
  };

  it("stores the connection when the state matches", async () => {
    const response = await callback("code=code-1&state=st-1", cookieFor("st-1"));
    expect(mocks.completeConnect).toHaveBeenCalledWith("person-1", "code-1", "ver-1");
    expect(response.headers.get("location")).toBe("http://localhost:3000/settings?gmail=connected#gmail");
    // Nothing from Google comes back to the browser
    expect(response.headers.get("location")).not.toContain("code-1");
  });

  it("refuses a different state, another person's attempt, or no cookie", async () => {
    for (const response of [
      await callback("code=c&state=other", cookieFor("st-1")),
      await callback("code=c&state=st-1", cookieFor("st-1", "person-2")),
      await callback("code=c&state=st-1"),
      await callback("code=c&state=st-1", cookieFor("st-1", "person-1", Date.now() - 60 * 60 * 1000)),
    ]) expect(response.headers.get("location")).toContain("gmail=failed");
    expect(mocks.completeConnect).not.toHaveBeenCalled();
  });

  it("reports a refused consent", async () => {
    const response = await callback("error=access_denied&state=st-1", cookieFor("st-1"));
    expect(response.headers.get("location")).toContain("gmail=denied");
  });
});
