import { appOrigin } from "./resource";

// DNS REBINDING GUARD (MCP spec): a browser always sends Origin, so a page on
// another site can never reach this server through someone's browser. Agents
// outside a browser send no Origin. The app's own origin is its deployment
// URL (APP_ORIGIN or Vercel's), or a loopback address while developing.
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return ownOrigins(request).has(origin);
}

function ownOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  if (process.env.APP_ORIGIN?.trim()) origins.add(appOrigin(request));
  for (const host of [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    if (host) origins.add(`https://${host}`);
  }
  const own = new URL(request.url);
  if (LOOPBACK.has(own.hostname)) origins.add(own.origin);
  return origins;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
