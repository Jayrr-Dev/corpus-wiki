// =====================================================================
// HTTP FOR THE OAUTH ENDPOINTS: JSON answers that are never cached, CORS
// open to any origin (no cookies are read, so browser-based MCP clients
// may call these too), and RFC 6749 error bodies.
// =====================================================================

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...NO_STORE, ...headers } });
}

// An RFC 6749 error; invalid_client answers 401, the rest 400
export function oauthError(error: string, description: string, status = error === "invalid_client" ? 401 : 400): Response {
  return oauthJson({ error, error_description: description }, status);
}

// The CORS preflight answer
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const MAX_FORM_BYTES = 16 * 1024;

// Reads an application/x-www-form-urlencoded body. Each parameter may
// appear once (RFC 6749 section 3.2). Returns an error message instead when it cannot.
export async function readForm(request: Request): Promise<Record<string, string> | string> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return "Send the request as application/x-www-form-urlencoded.";
  }
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES) return "The request body is too large.";
  const params = new URLSearchParams(text);
  const form: Record<string, string> = {};
  for (const [name, value] of params) {
    if (name in form) return `The ${name} parameter appears more than once.`;
    form[name] = value;
  }
  return form;
}

// The client_id of a public client: the form's, else the username of an HTTP Basic header
export function clientIdOf(request: Request, form: Record<string, string>): string | null {
  if (form.client_id) return form.client_id;
  const basic = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!basic?.[1]) return null;
  try {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    return decodeURIComponent(decoded.split(":")[0] ?? "") || null;
  } catch {
    return null;
  }
}
