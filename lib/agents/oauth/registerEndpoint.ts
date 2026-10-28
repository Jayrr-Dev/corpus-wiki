import "server-only";

import { ClientError, registerClient } from "./clients";
import { oauthJson } from "./http";

// =====================================================================
// DYNAMIC CLIENT REGISTRATION (POST /oauth/register, RFC 7591). Anyone
// may register a public client; a client can do nothing until a person
// signs in and consents. A small per-address limit keeps the table from
// being flooded (per server instance, so it is a speed bump, not a wall).
// =====================================================================

const MAX_BODY_BYTES = 16 * 1024;
const REGISTRATIONS_PER_HOUR = 20;
const recent = new Map<string, number[]>();

// True while this address is under its hourly registration limit (and counts this one)
function allowRegistration(address: string, now = Date.now()): boolean {
  const hourAgo = now - 60 * 60 * 1000;
  const times = (recent.get(address) ?? []).filter((time) => time > hourAgo);
  if (times.length >= REGISTRATIONS_PER_HOUR) return false;
  times.push(now);
  recent.set(address, times);
  if (recent.size > 10_000) recent.clear();
  return true;
}

function registrationError(error: string, description: string, status = 400): Response {
  return oauthJson({ error, error_description: description }, status);
}

export async function handleRegisterRequest(request: Request): Promise<Response> {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowRegistration(address)) return registrationError("invalid_request", "Too many registrations from this address. Try again later.", 429);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return registrationError("invalid_client_metadata", "Send the registration as application/json.");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return registrationError("invalid_client_metadata", "The registration is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return registrationError("invalid_client_metadata", "The registration is not valid JSON.");
  }
  try {
    const client = await registerClient(body);
    return oauthJson({
      client_id: client.client_id,
      client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
      client_name: client.name,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }, 201);
  } catch (error) {
    if (error instanceof ClientError) return registrationError(error.code, error.message);
    console.error("OAuth client registration failed:", error);
    return registrationError("server_error", "The client could not be registered. Try again.", 500);
  }
}
