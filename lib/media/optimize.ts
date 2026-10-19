import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import sharp from "sharp";

const ROOT = join(process.cwd(), ".next", "cache", "private-media");
const DAY = 86400_000;
export const MEDIA_WIDTHS = [320, 640, 960, 1600, 2400] as const;
export function mediaWidth(requested: string | null) {
  const width = Number(requested ?? 1600);
  return MEDIA_WIDTHS.find((size) => size >= (Number.isFinite(width) && width > 0 ? width : 1600)) ?? 2400;
}
const ownerKey = (bucket: string, path: string) => createHash("sha256").update(`${bucket}:${path}`).digest("hex");
export async function removeMediaCache(bucket: string, path: string) {
  await rm(join(ROOT, ownerKey(bucket, path)), { recursive: true, force: true });
}
export async function sweepMediaCache() {
  let owners: string[];
  try { owners = await readdir(ROOT); } catch { return; }
  for (const owner of owners) {
    if (!/^[a-f0-9]{64}$/.test(owner)) continue;
    const directory = join(ROOT, owner);
    for (const name of await readdir(directory)) {
      const file = join(directory, name);
      if (Date.now() - (await stat(file)).mtimeMs > 7 * DAY) await rm(file, { force: true });
    }
  }
}

export async function optimizeImage(bytes: Buffer, width: number) {
  const image = sharp(bytes, { animated: true, limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  // Preserve animation and SVG behavior rather than silently flattening it.
  if (metadata.format === "svg" || (metadata.pages ?? 1) > 1) return null;
  return image.rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
}

async function transcode(input: string, output: string, video: boolean) {
  const { default: bundled } = await import("ffmpeg-static");
  const binary = process.env.FFMPEG_PATH || bundled || "ffmpeg";
  const options = video
    ? ["-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale='min(1280,iw)':-2", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "6", "-crf", "36", "-b:v", "0", "-c:a", "libopus", "-b:a", "96k", "-f", "webm"]
    : ["-map", "0:a:0", "-vn", "-c:a", "libopus", "-b:a", "96k", "-f", "ogg"];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-nostdin", "-y", "-i", input, ...options, output], { windowsHide: true });
    let log = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Media conversion timed out")); }, 180_000);
    child.stdout.resume();
    child.stderr.on("data", (data: Buffer) => { log = (log + data.toString()).slice(-2000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Media conversion failed: ${log}`)); });
  });
}

// Single-flight conversion avoids duplicate work when a page repeats an image.
const pending = new Map<string, Promise<void>>();
let conversionTail: Promise<unknown> = Promise.resolve();
export async function optimizedMediaResponse(request: Request, options: {
  bucket: string; path: string; mime: string; download: () => Promise<Blob>;
  replace?: (bytes: Buffer, mime: string) => Promise<void>;
}): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.searchParams.has("original") || url.searchParams.has("download")) return null;
  const image = options.mime.startsWith("image/") && !["image/svg+xml", "image/gif"].includes(options.mime);
  const video = options.mime.startsWith("video/");
  const audio = options.mime.startsWith("audio/");
  if (!image && !video && !audio) return null;
  const width = mediaWidth(url.searchParams.get("w"));
  const mime = image ? "image/webp" : video ? "video/webm" : "audio/ogg; codecs=opus";
  const directory = join(ROOT, ownerKey(options.bucket, options.path));
  const file = join(directory, `v2-${image ? width : "media"}.${image ? "webp" : video ? "webm" : "ogg"}`);
  let hit = false;
  try { hit = Date.now() - (await stat(file)).mtimeMs < DAY; } catch { /* Generate on first request. */ }
  if (!hit) {
    let work = pending.get(file);
    if (!work) {
      if (pending.size >= (image ? 8 : 2)) return null;
      work = (async () => {
        const blob = await options.download();
        if (blob.size > (image ? 32 : 256) * 1024 * 1024) throw new Error("Media exceeds conversion size limit");
        await mkdir(directory, { recursive: true });
        const temporary = join(directory, randomUUID());
        const input = `${temporary}.input`, output = `${temporary}.output`;
        try {
          const bytes = Buffer.from(await blob.arrayBuffer());
          if (image) {
            if (options.replace && options.mime !== "image/webp") {
              const metadata = await sharp(bytes).metadata();
              const smaller = metadata.format === "webp" ? null : await optimizeImage(bytes, metadata.width ?? 2400);
              if (smaller && smaller.length < bytes.length) {
                await sharp(smaller).metadata();
                await options.replace(smaller, "image/webp");
              }
            }
            const optimized = await optimizeImage(bytes, width);
            if (!optimized) throw new Error("Preserve the original animated or vector image");
            await writeFile(output, optimized);
          } else {
            await writeFile(input, bytes);
            // Encode one audio/video at a time to bound CPU usage.
            const encode = conversionTail.then(() => transcode(input, output, video));
            conversionTail = encode.catch(() => {});
            await encode;
            if (options.replace && (await stat(output)).size < bytes.length) {
              const smaller = await readFile(output);
              if (smaller.length > 0) await options.replace(smaller, video ? "video/webm" : "audio/ogg");
            }
          }
          await rename(output, file);
        } finally { await rm(input, { force: true }); await rm(output, { force: true }); }
      })().finally(() => pending.delete(file));
      pending.set(file, work);
    }
    try { await work; } catch (error) {
      console.warn("Serving original media:", error instanceof Error ? error.message : String(error));
      return null;
    }
  }
  const info = await stat(file);
  const etag = `"${createHash("sha256").update(`${file}:${info.size}:${info.mtimeMs}`).digest("hex")}"`;
  const headers = new Headers({ "Content-Type": mime, "Cache-Control": "private, max-age=0, must-revalidate", ETag: etag, "X-Content-Type-Options": "nosniff", "X-Media-Cache": hit ? "HIT" : "MISS", "Accept-Ranges": "bytes" });
  if (request.headers.get("if-none-match") === etag && !request.headers.has("range")) return new Response(null, { status: 304, headers });
  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (!match || (!match[1] && !match[2]))) {
    headers.set("Content-Range", `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  let start = 0, end = info.size - 1;
  const useRange = match && (!request.headers.has("if-range") || request.headers.get("if-range") === etag);
  if (useRange) {
    start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      headers.set("Content-Range", `bytes */${info.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status: useRange ? 206 : 200, headers });
}
