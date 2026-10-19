import "server-only";
import { createHash } from "node:crypto";

export function cachedSvgResponse(request: Request, svg: string) {
  const etag = `"${createHash("sha256").update(svg).digest("hex")}"`;
  const headers = { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, max-age=0, must-revalidate", ETag: etag, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" };
  return request.headers.get("if-none-match") === etag ? new Response(null, { status: 304, headers }) : new Response(svg, { headers });
}
