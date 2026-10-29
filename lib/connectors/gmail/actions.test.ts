import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFeature: vi.fn(async () => undefined),
  requireUser: vi.fn(async () => ({ id: "person-1", email: null })),
  agent: vi.fn((): unknown => null),
  after: vi.fn(),
  service: {
    status: vi.fn(async () => ({ connected: true, accountEmail: "me@example.com", labelIds: ["INBOX"], lastImportAt: null })),
    importNow: vi.fn(async () => ({ imported: 1, skipped: 0, attachments: 0, failed: 0, more: false, eventIds: ["e1"] })),
    disconnect: vi.fn(async () => ({ revoked: true })),
  },
}));
vi.mock("@/lib/flags/server", () => ({ requireFeature: mocks.requireFeature }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agents/session", () => ({ currentAgentSession: mocks.agent }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/ingest", () => ({ processUploadEvent: vi.fn(), startEmailThreadSource: vi.fn(), startUploadFromAttachment: vi.fn() }));
vi.mock("./server", () => ({ serverGmailService: () => mocks.service }));

import { disconnectGmail, getGmailStatus, importGmailNow } from "./actions";

beforeEach(() => { vi.clearAllMocks(); });

describe("gmail actions", () => {
  it("are a 404 while the flag is off and touch nothing", async () => {
    mocks.requireFeature.mockRejectedValue(Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }));
    await expect(getGmailStatus()).rejects.toThrow("404");
    await expect(importGmailNow()).rejects.toThrow("404");
    await expect(disconnectGmail()).rejects.toThrow("404");
    expect(mocks.service.importNow).not.toHaveBeenCalled();
    expect(mocks.service.disconnect).not.toHaveBeenCalled();
    mocks.requireFeature.mockResolvedValue(undefined);
  });

  it("refuse agents", async () => {
    mocks.agent.mockReturnValueOnce({ key: { personId: "person-1" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await disconnectGmail()).toEqual({ ok: false, error: "Agents cannot manage the Gmail connection." });
    log.mockRestore();
    expect(mocks.service.disconnect).not.toHaveBeenCalled();
  });

  it("import answers with counts only and processes the new events after the response", async () => {
    const result = await importGmailNow();
    expect(result).toEqual({ ok: true, result: { imported: 1, skipped: 0, attachments: 0, failed: 0, more: false } });
    expect(mocks.service.importNow).toHaveBeenCalledWith("person-1", expect.objectContaining({ startThread: expect.any(Function), startAttachment: expect.any(Function) }));
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("disconnect deletes for the signed-in person", async () => {
    expect(await disconnectGmail()).toEqual({ ok: true, revoked: true });
    expect(mocks.service.disconnect).toHaveBeenCalledWith("person-1");
  });
});
