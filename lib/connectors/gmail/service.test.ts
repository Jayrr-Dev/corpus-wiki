import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { openTokens, sealTokens, tokenKeyFrom } from "./crypto";
import { GMAIL_READONLY_SCOPE, type GmailTokens } from "./oauth";
import { gmailService } from "./service";
import { type StoredConnection, gmailStore } from "./store";

const KEY = tokenKeyFrom(Buffer.alloc(32, 3).toString("base64"));
const client = { clientId: "cid", clientSecret: "csecret", redirectUri: "http://localhost:3000/api/gmail/callback" };
const PERSON = "11111111-1111-4111-8111-111111111111";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// An in-memory gmail_connections behind the DbRpc port
function fakeDb() {
  const rows = new Map<string, StoredConnection>();
  const call = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    const person = String(args.p_person_id);
    switch (fn) {
      case "gmail_get_connection": return rows.get(person) ?? null;
      case "gmail_save_connection": rows.set(person, { accountEmail: String(args.p_account_email), tokenCipher: String(args.p_token_cipher), labelIds: [], connectedAt: "now", lastImportAt: null }); return null;
      case "gmail_save_tokens": { const row = rows.get(person); if (row) row.tokenCipher = String(args.p_token_cipher); return Boolean(row); }
      case "gmail_set_labels": { const row = rows.get(person); if (row) row.labelIds = args.p_label_ids as string[]; return Boolean(row); }
      case "gmail_delete_connection": return rows.delete(person);
      case "gmail_mark_imported": return null;
      default: throw new Error(`unexpected ${fn}`);
    }
  });
  return { db: { call } as unknown as DbRpc, rows, call };
}

describe("gmailService", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => { db = fakeDb(); });

  it("connects: stores the account and sealed tokens, and status never shows them", async () => {
    const fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "access-xyz", refresh_token: "refresh-xyz", expires_in: 3600, scope: GMAIL_READONLY_SCOPE });
      if (url.endsWith("/users/me/profile")) return json({ emailAddress: "me@example.com" });
      throw new Error(url);
    });
    const service = gmailService({ store: gmailStore(db.db), fetch, key: KEY, client });
    expect(await service.completeConnect(PERSON, "code", "verifier")).toEqual({ accountEmail: "me@example.com" });

    const row = db.rows.get(PERSON)!;
    expect(row.tokenCipher).not.toContain("refresh-xyz");
    expect(openTokens<GmailTokens>(KEY, PERSON, row.tokenCipher).refreshToken).toBe("refresh-xyz");

    const status = await service.status(PERSON);
    expect(status).toEqual({ connected: true, accountEmail: "me@example.com", labelIds: [], lastImportAt: null });
    expect(JSON.stringify(status)).not.toMatch(/xyz|v1\./);
  });

  it("refreshes an expired access token and saves it sealed", async () => {
    db.rows.set(PERSON, { accountEmail: "me@example.com", tokenCipher: sealTokens(KEY, PERSON, { accessToken: "old", refreshToken: "rt", expiresAt: 0 }), labelIds: [], connectedAt: "now", lastImportAt: null });
    const seen: string[] = [];
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "new", expires_in: 3600 });
      seen.push(new Headers(init?.headers).get("authorization") ?? "");
      return json({ labels: [{ id: "Label_1", name: "Clients", type: "user" }, { id: "SPAM", name: "SPAM", type: "system" }, { id: "INBOX", name: "INBOX", type: "system" }] });
    });
    const labels = await gmailService({ store: gmailStore(db.db), fetch, key: KEY, client, now: () => 1_000 }).labels(PERSON);
    expect(labels).toEqual([{ id: "Label_1", name: "Clients", type: "user" }, { id: "INBOX", name: "INBOX", type: "system" }]);
    expect(seen).toEqual(["Bearer new"]);
    expect(openTokens<GmailTokens>(KEY, PERSON, db.rows.get(PERSON)!.tokenCipher)).toMatchObject({ accessToken: "new", refreshToken: "rt" });
  });

  it("validates labels before saving them", async () => {
    db.rows.set(PERSON, { accountEmail: "me@example.com", tokenCipher: "v1.x.y.z", labelIds: [], connectedAt: "now", lastImportAt: null });
    const service = gmailService({ store: gmailStore(db.db), fetch: vi.fn(), key: KEY, client });
    expect(await service.setLabels(PERSON, ["INBOX", "Label_1", "INBOX"])).toEqual(["INBOX", "Label_1"]);
    await expect(service.setLabels(PERSON, ["bad label; drop"])).rejects.toThrow(/not valid/);
    await expect(service.setLabels(PERSON, "INBOX")).rejects.toThrow(/not valid/);
  });

  it("disconnect deletes the stored tokens and asks Google to revoke them", async () => {
    db.rows.set(PERSON, { accountEmail: "me@example.com", tokenCipher: sealTokens(KEY, PERSON, { accessToken: "a", refreshToken: "rt-1", expiresAt: 0 }), labelIds: ["INBOX"], connectedAt: "now", lastImportAt: null });
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const service = gmailService({ store: gmailStore(db.db), fetch, key: KEY, client });
    expect(await service.disconnect(PERSON)).toEqual({ revoked: true });
    expect(db.rows.has(PERSON)).toBe(false);
    expect(db.call).toHaveBeenCalledWith("gmail_delete_connection", { p_person_id: PERSON });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init.body)).toBe("token=rt-1");
    expect(await service.status(PERSON)).toEqual({ connected: false });
  });

  it("disconnect still deletes tokens when Google cannot be reached or they cannot be opened", async () => {
    db.rows.set(PERSON, { accountEmail: "me@example.com", tokenCipher: "v1.broken.tag.body", labelIds: [], connectedAt: "now", lastImportAt: null });
    const fetch = vi.fn(async () => { throw new Error("offline"); });
    expect(await gmailService({ store: gmailStore(db.db), fetch, key: KEY, client }).disconnect(PERSON)).toEqual({ revoked: false });
    expect(db.rows.has(PERSON)).toBe(false);
  });
});
