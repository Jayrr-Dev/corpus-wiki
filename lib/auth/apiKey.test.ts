import { describe, expect, it } from "vitest";
import { apiKeyMatches, bearerToken } from "./apiKey";

describe("bearerToken", () => {
  it("reads the token after Bearer", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer  abc123 ")).toBe("abc123");
  });

  it("is null without a bearer header", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Basic abc123")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
  });
});

describe("apiKeyMatches", () => {
  it("accepts only the exact key", () => {
    expect(apiKeyMatches("secret", "secret")).toBe(true);
    expect(apiKeyMatches("secret", "secret2")).toBe(false);
    expect(apiKeyMatches("", "secret")).toBe(false);
  });

  it("refuses everything when no key is configured", () => {
    expect(apiKeyMatches("", undefined)).toBe(false);
    expect(apiKeyMatches("anything", "")).toBe(false);
  });
});
