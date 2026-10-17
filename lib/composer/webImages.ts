import "server-only";
import { DOMParser } from "linkedom";
import { withRequestSlot } from "@/lib/processing/requests";
import { uploadExecution } from "@/lib/ingest/workflowContext";

export type WebImage = { id: string; title: string; description: string; imageUrl: string; displayUrl?: string; sourceUrl: string; creator: string; license: string; licenseUrl: string };
type FilePage = { pageid: number; title: string; imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; mime?: string; extmetadata?: Record<string, { value?: string }> }[] };
const headers = { "User-Agent": "SecondBrainEngine/0.1 (article illustration search)" };
const MAX_BYTES = 20 * 1024 * 1024;
const plain = (html: string) => new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html").body.textContent?.trim() ?? "";
function trustedUrl(value: string, host: string) {
  try { const u = new URL(value); return u.protocol === "https:" && u.hostname === host && !u.username && !u.password && !u.port; } catch { return false; }
}

// Metadata comes from the original Commons file page, never from a search thumbnail.
export function commonsImage(page: FilePage): WebImage | null {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  const get = (key: string) => plain(meta[key]?.value ?? "");
  const license = get("LicenseShortName"), licenseUrl = get("LicenseUrl");
  if (!info?.url || !trustedUrl(info.url, "upload.wikimedia.org") || !info.descriptionurl || !trustedUrl(info.descriptionurl, "commons.wikimedia.org")) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(info.mime ?? "")) return null;
  if (!get("Artist") || !/^(CC BY(?:-SA)? [1-4]\.0|CC0(?: 1\.0)?|Public domain)$/i.test(license)) return null;
  if (license !== "Public domain" && !/^https?:\/\/creativecommons\.org\/(licenses\/(by|by-sa)\/|publicdomain\/zero\/)/.test(licenseUrl)) return null;
  if (get("Restrictions") || get("AttributionRequired") === "true" && !get("Artist")) return null;
  return { id: String(page.pageid), title: plain(page.title.replace(/^File:/, "")), description: get("ImageDescription").slice(0, 2000), imageUrl: info.url, sourceUrl: info.descriptionurl,
    displayUrl: info.thumburl && (trustedUrl(info.thumburl, "upload.wikimedia.org") || trustedUrl(info.thumburl, "thumb.wikimedia.org")) ? info.thumburl : undefined, creator: get("Artist"), license, licenseUrl };
}

export async function searchCommonsImages(query: string): Promise<WebImage[]> {
  const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: "6", prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "500", iiextmetadatalanguage: "en" });
  return withRequestSlot("search", "commons.wikimedia.org", "public", async (signal) => {
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Wikimedia image search failed (${response.status}).`);
    const body = await response.json() as { error?: unknown; query?: { pages?: FilePage[] } };
    if (body.error) throw new Error("Wikimedia image search is unavailable. Try another query or medium.");
    return (body.query?.pages ?? []).map(commonsImage).filter((image): image is WebImage => image !== null);
  }, uploadExecution.getStore()?.signal);
}

// Wikipedia's article editors offer another candidate pool; Commons still supplies
// the original file metadata and rights. Images are not accepted just for appearing there.
export async function searchWikipediaImages(query: string): Promise<WebImage[]> {
  const request = async (host: string, params: Record<string, string>) => withRequestSlot("search", host, "public", async (signal) => {
    const response = await fetch(`https://${host}/w/api.php?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params })}`, { headers, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Wikipedia image discovery failed (${response.status}).`);
    const body = await response.json();
    if (body.error) throw new Error("Wikipedia image discovery is unavailable.");
    return body;
  }, uploadExecution.getStore()?.signal);
  const body = await request("en.wikipedia.org", { generator: "search", gsrsearch: query, gsrlimit: "1", prop: "images", imlimit: "20" });
  const pages = body.query?.pages as { images?: { title: string }[] }[] | undefined;
  const titles = (pages ?? []).flatMap((p) => p.images ?? []).map((i) => i.title).filter((t) => /\.(jpg|jpeg|png|webp)$/i.test(t)).slice(0, 6);
  if (!titles.length) return [];
  const files = await request("commons.wikimedia.org", { titles: titles.join("|"), prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "500", iiextmetadatalanguage: "en" });
  return ((files.query?.pages ?? []) as FilePage[]).map(commonsImage).filter((image): image is WebImage => image !== null);
}

export async function downloadCommonsImage(image: WebImage) {
  const downloadUrl = image.displayUrl ?? image.imageUrl;
  if (!trustedUrl(downloadUrl, "upload.wikimedia.org") && !trustedUrl(downloadUrl, "thumb.wikimedia.org")) throw new Error("Unverified image host.");
  return withRequestSlot("web", "upload.wikimedia.org", "public", async (signal) => {
    const response = await fetch(downloadUrl, { headers, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!response.ok || !response.body) throw new Error(`Could not download the selected image (HTTP ${response.status}).`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("The selected image exceeds 20 MB. Choose another image.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks);
    const mime = response.headers.get("content-type")?.split(";")[0];
    const extension = mime === "image/jpeg" && bytes.subarray(0, 3).equals(Buffer.from([255,216,255])) ? "jpg"
      : mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png"
      : mime === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
    if (!extension) throw new Error("The selected file is not a supported raster image.");
    return { bytes, mime: mime!, extension };
  }, uploadExecution.getStore()?.signal);
}
