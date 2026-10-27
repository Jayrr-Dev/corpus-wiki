import "server-only";

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { parseHTML } from "linkedom";

const MAX_BYTES = 2 * 1024 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["192.0.0.0", 24], ["192.0.2.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) blocked.addSubnet(address, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export function linkUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a complete http:// or https:// link."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("Use a public HTTP or HTTPS link without a login or custom port.");
  url.hash = "";
  return url;
}

export function pageText(html: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  const title = document.querySelector("title")?.textContent?.trim() ?? "";
  document.querySelectorAll("script,style,noscript,nav,header,footer,aside,form,svg,[hidden],[aria-hidden='true']").forEach((node) => node.remove());
  const root = document.querySelector("article,main,[role='main']") ?? document.body;
  root.querySelectorAll("p,div,section,h1,h2,h3,h4,li,br,tr").forEach((node) => node.appendChild(document.createTextNode("\n")));
  return { title, text: (root.textContent ?? "").replace(/[\t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim() };
}

// Resolve every redirect and pin the validated address to the connection, preventing DNS rebinding.
export async function readLink(value: string): Promise<{ title: string; text: string; url: string }> {
  let url = linkUrl(value);
  const signal = AbortSignal.timeout(25_000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("Reading the link timed out."));
        else signal.addEventListener("abort", () => reject(new Error("Reading the link timed out.")), { once: true });
      }),
    ]);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Only publicly accessible websites can be read.");
    const target = addresses[0];
    if (!target) throw new Error("This website could not be found.");
    const result = await new Promise<{ location?: string; text?: string; type?: string }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        signal,
        agent: false,
        family: target.family,
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
        headers: { "User-Agent": "CorpusWiki/0.1", Accept: "text/html,text/plain,text/markdown", "Accept-Encoding": "identity" },
      }, (response) => {
        response.on("error", reject);
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          resolve({ location: response.headers.location }); response.destroy(); return;
        }
        if (status < 200 || status >= 300) { reject(new Error(`This page could not be read (HTTP ${status}). It may require sign-in or block automated access.`)); response.destroy(); return; }
        const type = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
        if (!["text/html", "application/xhtml+xml", "text/plain", "text/markdown"].includes(type ?? "")) { reject(new Error("This link is not a readable web page. Download the file and use Choose files instead.")); response.destroy(); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) { reject(new Error("This page is too large to import. Upload a saved excerpt instead.")); response.destroy(); }
          else chunks.push(chunk);
        });
        response.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), type }));
      });
      request.on("error", reject);
      request.end();
    });
    if (result.location) { url = linkUrl(new URL(result.location, url).href); continue; }
    const page = result.type?.includes("html") ? pageText(result.text ?? "") : { title: "", text: (result.text ?? "").trim() };
    if (page.text.length < 100) throw new Error("Not enough readable text was found. The page may need sign-in or JavaScript. Upload a saved copy instead.");
    if (page.text.length > 100_000) throw new Error("This page has too much text to import. Upload a shorter excerpt instead.");
    return { ...page, title: page.title || url.hostname, url: url.href };
  }
  throw new Error("This link redirects too many times. Try its final address.");
}
