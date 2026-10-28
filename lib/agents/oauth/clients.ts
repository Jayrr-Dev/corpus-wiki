import "server-only";

import { randomBytes } from "node:crypto";
import { redirectUriProblem } from "./redirects";
import { fetchPublicJson } from "./safeFetch";
import { getClient, saveClient, type OAuthClient } from "./store";

// =====================================================================
// OAUTH CLIENTS. Two ways a client becomes known, both public clients
// (no secret; PKCE protects the code):
// - Client ID Metadata Document: the client_id is an https URL serving
//   the client's metadata (Claude Code uses one). Fetched safely, kept
//   for a day, and the cached copy serves for a week if a refetch fails.
// - Dynamic Client Registration (RFC 7591): POST /oauth/register.
// =====================================================================

const FRESH_MS = 24 * 60 * 60 * 1000;
const STALE_OK_MS = 7 * FRESH_MS;
const MAX_REDIRECT_URIS = 20;
const MAX_NAME = 200;

// A client that cannot be used; code is the RFC 7591 error for a registration
export class ClientError extends Error {
  constructor(message: string, readonly code: "invalid_client_metadata" | "invalid_redirect_uri" = "invalid_client_metadata") {
    super(message);
  }
}

// Why a client_id URL cannot be a metadata document, or null (draft-ietf-oauth-client-id-metadata-document)
export function clientIdUrlProblem(clientId: string): string | null {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return "client_id is not a URL.";
  }
  if (url.protocol !== "https:") return "A client_id URL must use https.";
  if (url.pathname === "/" || url.pathname === "") return "A client_id URL must have a path.";
  if (url.hash || url.username || url.password) return "A client_id URL cannot have a fragment or credentials.";
  // URL() quietly resolves dot segments, so the raw string is checked
  if (/\/\.\.?(\/|$|\?)/.test(clientId) || /%2e/i.test(clientId)) return "A client_id URL cannot have . or .. segments.";
  return null;
}

// The client's display name: its own, trimmed and capped, else the fallback
function nameFrom(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  return name || fallback;
}

// Checks a list of redirect URIs; throws a ClientError naming the first bad one
function checkRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new ClientError("redirect_uris must be a non-empty array.", "invalid_redirect_uri");
  if (value.length > MAX_REDIRECT_URIS) throw new ClientError(`Register at most ${MAX_REDIRECT_URIS} redirect URIs.`, "invalid_redirect_uri");
  for (const uri of value) {
    const problem = redirectUriProblem(uri);
    if (problem) throw new ClientError(problem, "invalid_redirect_uri");
  }
  return [...new Set(value as string[])];
}

// Only public clients: no secret, no client authentication at the token endpoint
function checkPublicClient(metadata: Record<string, unknown>) {
  const method = metadata.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") throw new ClientError("Only public clients are supported: token_endpoint_auth_method must be none.");
  if ("client_secret" in metadata) throw new ClientError("Public clients have no client_secret.");
  const grants = metadata.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || grants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token"))) {
    throw new ClientError("grant_types may only list authorization_code and refresh_token.");
  }
  const responses = metadata.response_types;
  if (responses !== undefined && (!Array.isArray(responses) || responses.some((type) => type !== "code"))) {
    throw new ClientError("response_types may only list code.");
  }
}

// What we keep of a client's metadata: plain strings worth showing or auditing
function keptMetadata(metadata: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const field of ["client_uri", "software_id", "software_version"]) {
    const value = metadata[field];
    if (typeof value === "string" && value.length <= 500) kept[field] = value;
  }
  return kept;
}

// Fetches and checks a client's metadata document
async function fetchMetadataDocument(clientId: string) {
  const document = await fetchPublicJson(clientId);
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new ClientError("The client metadata document is not a JSON object.");
  const metadata = document as Record<string, unknown>;
  if (metadata.client_id !== clientId) throw new ClientError("The metadata document's client_id must equal its URL.");
  checkPublicClient(metadata);
  return saveClient({
    client_id: clientId,
    name: nameFrom(metadata.client_name, new URL(clientId).hostname),
    redirect_uris: checkRedirectUris(metadata.redirect_uris),
    kind: "cimd",
    metadata: keptMetadata(metadata),
  });
}

// The client a client_id names: a metadata document URL (fetched or cached)
// or a registered client. Throws a ClientError the person can read.
export async function resolveClient(clientId: string): Promise<OAuthClient> {
  if (!clientId || clientId.length > 2000) throw new ClientError("Missing or invalid client_id.");
  if (!clientId.startsWith("https://")) {
    const registered = await getClient(clientId);
    if (!registered || registered.kind !== "dcr") throw new ClientError("Unknown client. Register it first.");
    return registered;
  }
  const problem = clientIdUrlProblem(clientId);
  if (problem) throw new ClientError(problem);
  const cached = await getClient(clientId);
  const age = cached?.fetched_at ? Date.now() - Date.parse(cached.fetched_at) : Infinity;
  if (cached && age < FRESH_MS) return cached;
  try {
    return await fetchMetadataDocument(clientId);
  } catch (error) {
    if (cached && age < STALE_OK_MS) return cached;
    if (error instanceof ClientError) throw error;
    throw new ClientError(error instanceof Error ? error.message : "Could not fetch the client metadata document.");
  }
}

// DYNAMIC CLIENT REGISTRATION (RFC 7591): checks the request and saves a public client
export async function registerClient(body: unknown): Promise<OAuthClient> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ClientError("The registration must be a JSON object.");
  const metadata = body as Record<string, unknown>;
  checkPublicClient(metadata);
  const redirectUris = checkRedirectUris(metadata.redirect_uris);
  return saveClient({
    client_id: `cwd_${randomBytes(16).toString("base64url")}`,
    name: nameFrom(metadata.client_name, "Unnamed agent"),
    redirect_uris: redirectUris,
    kind: "dcr",
    metadata: keptMetadata(metadata),
  });
}
