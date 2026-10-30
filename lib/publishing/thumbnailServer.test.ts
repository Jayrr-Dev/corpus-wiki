import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicationEditor, ThumbnailState } from "./types";

const mocks = vi.hoisted(() => ({
  tokenFactoryFromEnv: vi.fn(), chatJson: vi.fn(), download: vi.fn(), upload: vi.fn(), remove: vi.fn(), call: vi.fn(), assets: [] as unknown[],
}));

vi.mock("@/lib/ai/chat", () => ({ tokenFactoryFromEnv: mocks.tokenFactoryFromEnv, chatJson: mocks.chatJson }));
vi.mock("@/lib/ai/models", () => ({ readModelChoice: async () => null }));
vi.mock("@/lib/billing/server", () => ({ serverUsageGate: () => undefined }));
vi.mock("@/lib/db/rpc", () => ({ supabaseRpc: () => ({ call: mocks.call }) }));
vi.mock("./thumbnailImage", () => ({ cleanThumbnail: async (bytes: ArrayBuffer) => { if (bytes.byteLength === 0) throw new Error("too small"); return Buffer.from("webp"); } }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminSupabase: () => {
    const query = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: async () => ({ data: mocks.assets, error: null }) };
    return { from: () => query, storage: { from: () => ({ download: mocks.download, upload: mocks.upload, remove: mocks.remove }) } };
  },
}));

import { pickThumbnail } from "./thumbnailServer";

const picture = (id: string, asset_type: string) => ({ id, kind: "image", mime_type: "image/png", storage_path: `space/${id}.png`, deleted_at: null, title: id, description: null, tags: null, asset_type, created_at: "2026-10-01T00:00:00Z" });
const editor = { spaceName: "Coffee", publication: null, publishedPages: [] } as unknown as PublicationEditor;
const state: ThumbnailState = { slug: "a".repeat(32), path: null, version: null, auto: true };
const downloaded = () => mocks.download.mock.calls.map(([path]) => path as string);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assets = [picture("chart", "chart"), picture("photo", "photo")];
  mocks.tokenFactoryFromEnv.mockReturnValue({});
  mocks.download.mockResolvedValue({ data: new Blob(["bytes"]), error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.call.mockResolvedValue(null);
});

describe("picking a thumbnail automatically", () => {
  it("uses the AI's choice when it gives one", async () => {
    mocks.chatJson.mockResolvedValue({ value: { choice: 1 } }); // index 1 of the ranked list is the chart
    expect(await pickThumbnail(editor, state)).toBe(true);
    expect(downloaded()).toEqual(["space/chart.png"]);
  });

  it("falls back to the ranking with no AI provider set up", async () => {
    mocks.tokenFactoryFromEnv.mockReturnValue(null);
    expect(await pickThumbnail(editor, state)).toBe(true);
    expect(downloaded()).toEqual(["space/photo.png"]);
    expect(mocks.chatJson).not.toHaveBeenCalled();
  });

  it("falls back when a model is picked but its key is missing", async () => {
    mocks.tokenFactoryFromEnv.mockImplementation(() => { throw new Error("No key"); });
    expect(await pickThumbnail(editor, state)).toBe(true);
    expect(downloaded()).toEqual(["space/photo.png"]);
  });

  it("falls back when the AI call fails or the AI declines", async () => {
    mocks.chatJson.mockRejectedValue(new Error("Usage limit"));
    expect(await pickThumbnail(editor, state)).toBe(true);
    mocks.chatJson.mockResolvedValue({ value: { choice: null } });
    expect(await pickThumbnail(editor, state)).toBe(true);
    expect(downloaded()).toEqual(["space/photo.png", "space/photo.png"]);
  });

  it("stops waiting for an AI that never answers", async () => {
    vi.useFakeTimers();
    try {
      mocks.chatJson.mockReturnValue(new Promise(() => {}));
      const picked = pickThumbnail(editor, state);
      await vi.advanceTimersByTimeAsync(8000);
      expect(await picked).toBe(true);
      expect(downloaded()).toEqual(["space/photo.png"]);
    } finally { vi.useRealTimers(); }
  });

  it("moves to the next picture when one will not load or is unusable", async () => {
    mocks.tokenFactoryFromEnv.mockReturnValue(null);
    mocks.download.mockResolvedValueOnce({ data: null, error: new Error("gone") });
    expect(await pickThumbnail(editor, state)).toBe(true);
    expect(downloaded()).toEqual(["space/photo.png", "space/chart.png"]);

    mocks.download.mockClear();
    mocks.download.mockResolvedValueOnce({ data: new Blob([]), error: null });
    expect(await pickThumbnail(editor, state)).toBe(true);
    expect(downloaded()).toEqual(["space/photo.png", "space/chart.png"]);
  });

  it("reports nothing picked, without failing, when no picture works", async () => {
    mocks.tokenFactoryFromEnv.mockReturnValue(null);
    mocks.download.mockResolvedValue({ data: null, error: new Error("gone") });
    expect(await pickThumbnail(editor, state)).toBe(false);
    mocks.assets = [];
    expect(await pickThumbnail(editor, state)).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("saves the picture under the publication's slug and marks it as automatic", async () => {
    mocks.tokenFactoryFromEnv.mockReturnValue(null);
    await pickThumbnail(editor, state);
    const path = mocks.upload.mock.calls[0]![0] as string;
    expect(path).toMatch(new RegExp(`^${state.slug}/[a-f0-9]{64}\\.webp$`));
    expect(mocks.call).toHaveBeenCalledWith("set_space_thumbnail", { p_path: path, p_auto: true });
  });
});
