import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { canBeThumbnail, rankThumbnailAssets, spaceCover, type ThumbnailAsset } from "./thumbnail";
import { cleanThumbnail, showsWhole } from "./thumbnailImage";

const asset = (over: Partial<ThumbnailAsset>): ThumbnailAsset => ({ id: "1", kind: "image", mime_type: "image/png", storage_path: "space/a.png", deleted_at: null, title: null, description: null, tags: null, asset_type: null, created_at: "2026-10-01T00:00:00Z", ...over });
const context = { title: "Coffee roasting", description: "", pageTitles: ["Origin notes"] };

describe("which assets can be a thumbnail", () => {
  it("takes stored pictures only", () => {
    expect(canBeThumbnail(asset({}))).toBe(true);
    expect(canBeThumbnail(asset({ storage_path: "composer-images/a.webp" }))).toBe(true);
    for (const over of [{ kind: "video" }, { mime_type: "image/svg+xml" }, { deleted_at: "2026-10-02T00:00:00Z" }, { storage_path: "generated/vector/a" }, { storage_path: "https://x.supabase.co/logo.png" }]) {
      expect(canBeThumbnail(asset(over))).toBe(false);
    }
  });
});

describe("the rule-based ranking", () => {
  it("prefers photos over charts, and pushes logos and tables to the end", () => {
    const ranked = rankThumbnailAssets([asset({ id: "t", asset_type: "table" }), asset({ id: "l", asset_type: "logo" }), asset({ id: "c", asset_type: "chart" }), asset({ id: "p", asset_type: "photo" })], context);
    expect(ranked.map(a => a.id)).toEqual(["p", "c", "l", "t"]);
  });
  it("puts the Space's own logo first, but not a logo named after something else", () => {
    const space = { title: "Nebius", description: "", pageTitles: [] };
    const assets = [asset({ id: "photo", asset_type: "photo", title: "Data centre" }), asset({ id: "own", asset_type: "logo", title: "Nebius logo on yellow background" }), asset({ id: "partner", asset_type: "logo", title: "Partner logo" })];
    expect(rankThumbnailAssets(assets, space).map(a => a.id)).toEqual(["own", "photo", "partner"]);
  });
  it("lets words shared with the Space break a tie", () => {
    const ranked = rankThumbnailAssets([asset({ id: "other", asset_type: "photo", title: "Office party" }), asset({ id: "match", asset_type: "photo", title: "Coffee roasting drum" })], context);
    expect(ranked[0]!.id).toBe("match");
  });
  it("gives the same order whatever order the assets arrive in", () => {
    const list = [asset({ id: "a" }), asset({ id: "b" }), asset({ id: "c", created_at: "2026-10-05T00:00:00Z" })];
    expect(rankThumbnailAssets([...list].reverse(), context).map(a => a.id)).toEqual(rankThumbnailAssets(list, context).map(a => a.id));
  });
  it("drops what cannot be used and copes with nothing", () => {
    expect(rankThumbnailAssets([asset({ kind: "audio" })], context)).toEqual([]);
    expect(rankThumbnailAssets([], context)).toEqual([]);
  });
});

describe("the drawn cover", () => {
  it("is the same every time for one Space and differs between Spaces", () => {
    expect(spaceCover("a".repeat(32), "Wiki")).toEqual(spaceCover("a".repeat(32), "Wiki"));
    expect(spaceCover("a".repeat(32), "Wiki")).not.toEqual(spaceCover("b".repeat(32), "Wiki"));
  });
  it("works with an accented or blank title", () => {
    expect(spaceCover("c", "éclair").initial).toBe("É");
    expect(spaceCover("c", "  ").initial).toBe("");
  });
});

describe("the cleaned copy", () => {
  const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#496748" } }).withMetadata({ exif: { IFD0: { Copyright: "secret" } } }).jpeg().toBuffer();

  it("is a 960 by 600 WebP with no metadata", async () => {
    const out = await sharp(await cleanThumbnail(await png(1200, 1200))).metadata();
    expect([out.format, out.width, out.height, out.exif]).toEqual(["webp", 960, 600, undefined]);
  });
  it("keeps a logo whole on its own colour instead of cropping it", async () => {
    const wide = await sharp({ create: { width: 900, height: 300, channels: 3, background: "#e4ff3a" } }).composite([{ input: await sharp({ create: { width: 20, height: 300, channels: 3, background: "#102030" } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer();
    const { data } = await sharp(await cleanThumbnail(wide, { logo: true })).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * 960 + x) * 3, (y * 960 + x) * 3 + 3));
    expect(pixel(5, 5)[2]).toBeLessThan(120); // the corner is the yellow background
    expect(pixel(5, 5)[0]).toBeGreaterThan(180);
    expect(pixel(102, 300)[0]).toBeLessThan(80); // the dark mark at the far left edge survived
  });
  it("crops ordinary pictures and keeps very wide or tall ones whole", () => {
    expect(showsWhole(1600, 1000, false)).toBe(false);
    expect(showsWhole(1200, 1200, false)).toBe(false);
    expect(showsWhole(1600, 1000, true)).toBe(true);
    expect(showsWhole(1000, 200, false)).toBe(true);
    expect(showsWhole(300, 1000, false)).toBe(true);
  });
  it("refuses SVG even when it is named as something else", async () => {
    await expect(cleanThumbnail(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><script>alert(1)</script></svg>'))).rejects.toThrow("PNG, JPEG");
  });
  it("refuses a file that is not an image, and one that is too small", async () => {
    await expect(cleanThumbnail(Buffer.from("not an image"))).rejects.toThrow("PNG, JPEG");
    await expect(cleanThumbnail(await png(64, 64))).rejects.toThrow("too small");
  });
});
