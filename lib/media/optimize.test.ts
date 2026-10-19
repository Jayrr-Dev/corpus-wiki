import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { mediaWidth, optimizedMediaResponse, removeMediaCache } from "./optimize";

it("resizes to WebP, reuses the cache, revalidates, and supports byte ranges", async () => {
  const bytes = await sharp({ create: { width: 1200, height: 800, channels: 4, background: "#234567" } }).png().toBuffer();
  const path = `${randomUUID()}.png`;
  const download = vi.fn(async () => new Blob([new Uint8Array(bytes)]));
  const options = { bucket: "test", path, mime: "image/png", download };
  try {
    const first = (await optimizedMediaResponse(new Request("http://localhost/image?w=320"), options))!;
    expect(first.headers.get("content-type")).toBe("image/webp");
    expect(first.headers.get("x-media-cache")).toBe("MISS");
    const converted = Buffer.from(await first.arrayBuffer());
    expect(await sharp(converted).metadata()).toMatchObject({ width: 320, height: 213, format: "webp" });
    const second = (await optimizedMediaResponse(new Request("http://localhost/image?w=320"), options))!;
    expect(second.headers.get("x-media-cache")).toBe("HIT");
    await second.arrayBuffer();
    expect(download).toHaveBeenCalledTimes(1);
    const etag = first.headers.get("etag")!;
    const unchanged = (await optimizedMediaResponse(new Request("http://localhost/image?w=320", { headers: { "If-None-Match": etag } }), options))!;
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("cache-control")).toContain("private");
    const partial = (await optimizedMediaResponse(new Request("http://localhost/image?w=320", { headers: { Range: "bytes=0-9" } }), options))!;
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(converted.subarray(0, 10));
    const invalid = (await optimizedMediaResponse(new Request("http://localhost/image?w=320", { headers: { Range: "bytes=999999-" } }), options))!;
    expect(invalid.status).toBe(416);
    expect(await optimizedMediaResponse(new Request("http://localhost/image?download=1"), options)).toBeNull();
    expect(await optimizedMediaResponse(new Request("http://localhost/image?original=1"), options)).toBeNull();
  } finally { await removeMediaCache("test", path); }
});

it("bounds image sizes and leaves vector and animated formats alone", async () => {
  expect(mediaWidth("999999")).toBe(2400);
  expect(mediaWidth("NaN")).toBe(1600);
  const download = vi.fn();
  for (const mime of ["image/svg+xml", "image/gif", "application/pdf"]) {
    expect(await optimizedMediaResponse(new Request("http://localhost/file"), { bucket: "test", path: "skip", mime, download })).toBeNull();
  }
  expect(download).not.toHaveBeenCalled();
});

it("replaces the stored original only with a smaller verified full-resolution copy", async () => {
  const bytes = await sharp({ create: { width: 1200, height: 800, channels: 4, background: "#123456" } }).png().toBuffer();
  const path = randomUUID();
  const replace = vi.fn(async (smaller: Buffer, mime: string) => {
    expect(smaller.length).toBeLessThan(bytes.length);
    expect(mime).toBe("image/webp");
    expect(await sharp(smaller).metadata()).toMatchObject({ width: 1200, height: 800 });
  });
  try {
    const response = (await optimizedMediaResponse(new Request("http://localhost/image?w=320"), {
      bucket: "test", path, mime: "image/png", replace, download: async () => new Blob([new Uint8Array(bytes)]),
    }))!;
    await response.arrayBuffer();
    expect(replace).toHaveBeenCalledOnce();
  } finally { await removeMediaCache("test", path); }
});

it("encodes real video as WebM and audio as Ogg/Opus, then reuses both", async () => {
  const { default: bundled } = await import("ffmpeg-static");
  const binary = process.env.FFMPEG_PATH || bundled || "ffmpeg";
  const directory = await mkdtemp(join(tmpdir(), "media-opt-test-"));
  try {
    for (const kind of ["video", "audio"] as const) {
      const file = join(directory, kind === "video" ? "input.mp4" : "input.wav");
      await promisify(execFile)(binary, ["-hide_banner", "-y", "-f", "lavfi", "-i", kind === "video" ? "testsrc2=size=64x64:rate=10" : "sine=frequency=440", "-t", "0.3", file], { windowsHide: true });
      const bytes = await readFile(file), path = randomUUID();
      const download = vi.fn(async () => new Blob([new Uint8Array(bytes)]));
      const options = { bucket: "test", path, mime: kind === "video" ? "video/mp4" : "audio/wav", download };
      try {
        const response = (await optimizedMediaResponse(new Request("http://localhost/media"), options))!;
        expect(response.headers.get("content-type")).toBe(kind === "video" ? "video/webm" : "audio/ogg; codecs=opus");
        const output = Buffer.from(await response.arrayBuffer());
        if (kind === "video") expect(output.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
        else { expect(output.subarray(0, 4).toString()).toBe("OggS"); expect(output.includes(Buffer.from("OpusHead"))).toBe(true); }
        const cached = (await optimizedMediaResponse(new Request("http://localhost/media"), options))!;
        await cached.arrayBuffer();
        expect(download).toHaveBeenCalledTimes(1);
      } finally { await removeMediaCache("test", path); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
