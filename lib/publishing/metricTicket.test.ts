import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dailyMetricHash, makeMetricTicket, readMetricTicket } from "./metricTicket";

describe("public reader metric tickets", () => {
  const input = { slug: "a".repeat(32), page: "soil", edition: "10000000-0000-4000-8000-000000000001", surface: "embed" as const, channel: "embed" as const };
  const now = Date.UTC(2026, 9, 18, 12);
  beforeEach(() => vi.stubEnv("SUPABASE_SECRET_KEY", "test-only-metric-key"));
  afterEach(() => vi.unstubAllEnvs());
  it("binds signed tickets to the edition, page and reader surface", () => {
    const token = makeMetricTicket(input, now);
    expect(readMetricTicket(token, now)).toMatchObject(input);
    const [data, signature] = token.split(".");
    const body = JSON.parse(Buffer.from(data!, "base64url").toString());
    const tampered = Buffer.from(JSON.stringify({ ...body, page: "other" })).toString("base64url");
    expect(readMetricTicket(`${tampered}.${signature}`, now)).toBeNull();
    for (const malformed of ["", token + ".extra", `${data}.xyz`, "a".repeat(2501)]) expect(readMetricTicket(malformed, now)).toBeNull();
  });
  it("expires tickets and rejects them after signing-key rotation", () => {
    const token = makeMetricTicket(input, now);
    expect(readMetricTicket(token, now + 3600_000)).toBeNull();
    vi.stubEnv("SUPABASE_SECRET_KEY", "rotated-key");
    expect(readMetricTicket(token, now)).toBeNull();
  });
  it("rotates irreversible hashes each UTC day and separates visitor and flood keys", () => {
    const today = new Date(now), tomorrow = new Date(now + 86400_000);
    const visitor = dailyMetricHash("visitor", "random-tab-id", today);
    expect(visitor).toMatch(/^[a-f0-9]{64}$/);
    expect(visitor).not.toContain("random-tab-id");
    expect(visitor).toBe(dailyMetricHash("visitor", "random-tab-id", today));
    expect(visitor).not.toBe(dailyMetricHash("visitor", "random-tab-id", tomorrow));
    expect(visitor).not.toBe(dailyMetricHash("rate", "random-tab-id", today));
  });
});
