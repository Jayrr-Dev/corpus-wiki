import "server-only";
import { withRequestSlot } from "@/lib/processing/requests";
import { uploadExecution } from "@/lib/ingest/workflowContext";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// =====================================================================
// LOGOS: from a stakeholder's official website, the icon the site itself
// declares (apple-touch-icon first, then the largest icon), else
// /favicon.ico. Only public http(s) hosts are fetched, every response is
// size-capped and must be an image. Returns null when nothing usable.
// =====================================================================

const TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 300_000;
const MIN_IMAGE_BYTES = 100;
const USER_AGENT = "CorpusWiki/0.1 (stakeholder logo)";

export type Logo = { bytes: Uint8Array; contentType: string; extension: string };

// PUBLIC HOSTS ONLY: no IP literals, no local names, and the name must not resolve to a private address
export async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase();
  if (!host.includes(".") || isIP(host) || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return lower === "::1" || lower === "::" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  const [a = 0, b = 0] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function capped(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol) || !(await isPublicHost(parsed.hostname))) return null;
  const signal = uploadExecution.getStore()?.signal;
  return withRequestSlot("web", "logos", "public", async (requestSignal) => {
  const response = await fetch(parsed, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!response.ok || !response.body) return null;
  // A redirect may land elsewhere: check where it ended
  if (response.url && !(await isPublicHost(new URL(response.url).hostname))) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, contentType: (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() };
  }, signal);
}

// The icon links a page declares, best first: apple-touch-icon, then icons by declared size, svg last
export function iconCandidates(html: string, base: string): string[] {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((value) => value !== undefined) ?? null;
  const scored = links.flatMap((tag) => {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel)) return [];
    let url: string;
    try { url = new URL(href, base).toString(); } catch { return []; }
    const size = Math.max(0, ...(attr(tag, "sizes") ?? "").split(/\s+/).map((s) => Number(s.split("x")[0]) || 0));
    const score = (rel.includes("apple-touch-icon") ? 1000 : 0) + size - (/\.svg(\?|$)/i.test(url) ? 500 : 0);
    return [{ url, score }];
  });
  return [...new Set(scored.sort((a, b) => b.score - a.score).map((item) => item.url))];
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/svg+xml": "svg",
};

// THE LOGO OF A WEBSITE, or null
export async function fetchLogo(website: string): Promise<Logo | null> {
  let base: URL;
  try { base = new URL(website); } catch { return null; }
  const candidates: string[] = [];
  try {
    const page = await capped(base.toString(), MAX_HTML_BYTES);
    if (page?.contentType.includes("html")) candidates.push(...iconCandidates(new TextDecoder().decode(page.bytes), base.toString()));
  } catch { uploadExecution.getStore()?.signal?.throwIfAborted(); /* an unreachable home page still leaves /favicon.ico */ }
  candidates.push(new URL("/favicon.ico", base).toString());
  for (const url of candidates.slice(0, 5)) {
    try {
      const image = await capped(url, MAX_IMAGE_BYTES);
      const extension = image ? EXTENSIONS[image.contentType] : undefined;
      // SVG can carry script; only raster images are kept
      if (image && extension && extension !== "svg" && image.bytes.byteLength >= MIN_IMAGE_BYTES) return { bytes: image.bytes, contentType: image.contentType, extension };
    } catch { uploadExecution.getStore()?.signal?.throwIfAborted(); /* try the next one */ }
  }
  return null;
}
