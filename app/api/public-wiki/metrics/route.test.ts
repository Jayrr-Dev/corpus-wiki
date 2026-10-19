import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeMetricTicket } from "@/lib/publishing/metricTicket";
import { POST } from "./route";

const { record } = vi.hoisted(() => ({ record: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: record }) }));

describe("public reading telemetry endpoint", () => {
  const origin = "https://wiki.example";
  beforeEach(() => { vi.stubEnv("SUPABASE_SECRET_KEY", "test-only-key"); record.mockClear(); });
  afterEach(() => vi.unstubAllEnvs());
  const data = () => ({ ticket: makeMetricTicket({ slug: "a".repeat(32), page: "soil", edition: "10000000-0000-4000-8000-000000000001", surface: "site", channel: "explore" }), visitor: "20000000-0000-4000-8000-000000000001", kind: "view" });
  const request = (body: string, headers: Record<string, string> = {}) => new NextRequest(`${origin}/api/public-wiki/metrics`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body });
  it("records only ticket-bound fields and irreversible daily hashes", async () => {
    expect((await POST(request(JSON.stringify(data()), { "x-real-ip": "192.0.2.10" }))).status).toBe(204);
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith("record_public_wiki_event", expect.objectContaining({ p_slug: "a".repeat(32), p_page: "soil", p_channel: "explore", p_kind: "view", p_visitor: expect.stringMatching(/^[a-f0-9]{64}$/), p_rate: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(JSON.stringify(record.mock.calls)).not.toContain("192.0.2.10");
    expect(JSON.stringify(record.mock.calls)).not.toContain(data().visitor);
  });
  it("rejects cross-origin, tampered, malformed and oversized requests before writing", async () => {
    expect((await POST(request(JSON.stringify(data()), { origin: "https://other.example" }))).status).toBe(403);
    expect((await POST(request(JSON.stringify(data()), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request("not json"))).status).toBe(400);
    expect((await POST(request("x".repeat(4001)))).status).toBe(413);
    expect((await POST(request(JSON.stringify({ ...data(), ticket: "fake" })))).status).toBe(403);
    expect((await POST(request(JSON.stringify({ ...data(), visitor: "not-a-uuid" })))).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });
  it("drops known bot traffic", async () => {
    expect((await POST(request(JSON.stringify(data()), { "user-agent": "Googlebot" }))).status).toBe(204);
    expect(record).not.toHaveBeenCalled();
  });
});
