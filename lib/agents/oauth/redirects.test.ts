import { expect, it } from "vitest";
import { clientRedirect, isLoopbackUri, redirectUriMatches, redirectUriProblem } from "./redirects";

it("registers https and loopback http only", () => {
  expect(redirectUriProblem("https://claude.ai/api/mcp/auth_callback")).toBeNull();
  expect(redirectUriProblem("http://localhost/callback")).toBeNull();
  expect(redirectUriProblem("http://127.0.0.1:33418/callback")).toBeNull();
  expect(redirectUriProblem("http://[::1]/cb")).toBeNull();
  for (const bad of ["http://example.com/cb", "javascript:alert(1)", "https://x.test/cb#frag", "https://u:p@x.test/cb", "/relative", 7]) {
    expect(redirectUriProblem(bad)).not.toBeNull();
  }
});

it("matches exactly, except a loopback URI on any port", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback", "http://localhost/callback", "http://127.0.0.1/cb?x=1"];
  expect(redirectUriMatches(registered, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
  expect(redirectUriMatches(registered, "http://localhost:51234/callback")).toBe(true);
  expect(redirectUriMatches(registered, "http://127.0.0.1:9/cb?x=1")).toBe(true);
  expect(redirectUriMatches(registered, "https://claude.ai/api/mcp/auth_callback/")).toBe(false);
  expect(redirectUriMatches(registered, "https://claude.ai:8443/api/mcp/auth_callback")).toBe(false);
  expect(redirectUriMatches(registered, "http://localhost:51234/other")).toBe(false);
  expect(redirectUriMatches(registered, "http://127.0.0.1:51234/callback")).toBe(false);
  expect(redirectUriMatches(registered, "http://localhost.evil.test/callback")).toBe(false);
});

it("knows loopback URIs", () => {
  expect(isLoopbackUri("http://localhost:3000/cb")).toBe(true);
  expect(isLoopbackUri("https://localhost/cb")).toBe(false);
});

it("adds the answer to the redirect URI's own query", () => {
  expect(clientRedirect("https://c.test/cb?keep=1", { code: "abc", state: null, iss: "https://wiki.test" }))
    .toBe("https://c.test/cb?keep=1&code=abc&iss=https%3A%2F%2Fwiki.test");
});
