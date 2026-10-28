import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// =====================================================================
// SAFE FETCH for Client ID Metadata Documents. The URL comes from a
// stranger, so the server must not be tricked into reaching its own
// network (SSRF): https only, no redirects, and every address the host
// resolves to must be public. The check runs inside the connection's own
// DNS lookup, so a name cannot resolve one way when checked and another
// when connected (DNS rebinding). 5 seconds and 64 KB at most.
// =====================================================================

export const FETCH_TIMEOUT_MS = 5_000;
export const MAX_DOCUMENT_BYTES = 64 * 1024;

// Private, loopback, link-local, shared, documentation, multicast and reserved ranges
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED.addSubnet(network, prefix, "ipv6");

// True when an IP address must not be reached from the server
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, "ipv4");
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1 or ::ffff:a00:1) is judged as IPv4.
    // (BlockList itself would match every IPv4 address against an ::ffff:0:0/96 rule.)
    const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (dotted?.[1]) return BLOCKED.check(dotted[1], "ipv4");
    const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
    if (hex?.[1] && hex[2]) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return BLOCKED.check(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, "ipv4");
    }
    return BLOCKED.check(address, "ipv6");
  }
  return true;
}

// The connection's DNS lookup: resolves every address and refuses the host if any is blocked
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 0);
    if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
      return callback(Object.assign(new Error(`${hostname} resolves to an address the server may not reach`), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
};

// GETs an https URL as JSON with the guards above; throws an Error saying what went wrong
export async function fetchPublicJson(target: string): Promise<unknown> {
  const url = new URL(target);
  if (url.protocol !== "https:") throw new Error("The URL must use https.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // A literal IP skips DNS, so it is checked here
  if (isIP(host) && isBlockedAddress(host)) throw new Error("The URL points to an address the server may not reach.");
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("The URL points to this computer.");

  const body = await new Promise<string>((resolve, reject) => {
    const req = request(url, {
      method: "GET",
      lookup: guardedLookup,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`The document answered HTTP ${response.statusCode}; it must answer 200 without a redirect.`));
      }
      if (Number(response.headers["content-length"] ?? 0) > MAX_DOCUMENT_BYTES) {
        response.destroy();
        return reject(new Error("The document is larger than 64 KB."));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_DOCUMENT_BYTES) {
          response.destroy();
          reject(new Error("The document is larger than 64 KB."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", reject);
    });
    req.on("error", (error) => reject(new Error(`Could not fetch the document: ${error.message}`)));
    req.end();
  });
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("The document is not JSON.");
  }
}
