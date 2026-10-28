// =====================================================================
// REDIRECT URIS (OAuth 2.1, RFC 8252). A client registers https URIs, or
// http URIs on a loopback host for apps running on the person's computer.
// A request must name a registered URI exactly, except that a loopback
// URI matches on any port (a local app picks a free port each time).
// =====================================================================

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

// True for http://localhost..., http://127.0.0.1... and http://[::1]...
export function isLoopbackUri(uri: string): boolean {
  const url = parse(uri);
  return url !== null && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

// Why a URI cannot be registered, or null when it can
export function redirectUriProblem(uri: unknown): string | null {
  if (typeof uri !== "string" || uri.length > 2000) return "A redirect URI must be a string of at most 2000 characters.";
  const url = parse(uri);
  if (!url) return `Not an absolute URL: ${uri}`;
  if (url.hash || uri.includes("#")) return `A redirect URI cannot have a fragment: ${uri}`;
  if (url.username || url.password) return `A redirect URI cannot carry credentials: ${uri}`;
  if (url.protocol === "https:") return null;
  if (isLoopbackUri(uri)) return null;
  return `Use https, or http on localhost or 127.0.0.1: ${uri}`;
}

// Whether a requested redirect URI matches one the client registered
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const asked = parse(requested);
  if (!asked || !isLoopbackUri(requested)) return false;
  return registered.some((uri) => {
    const known = parse(uri);
    return known !== null && isLoopbackUri(uri)
      && known.hostname === asked.hostname && known.pathname === asked.pathname && known.search === asked.search;
  });
}

// A redirect back to the client: the code or error, plus state and iss (RFC 9207)
export function clientRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value);
  return url.toString();
}
