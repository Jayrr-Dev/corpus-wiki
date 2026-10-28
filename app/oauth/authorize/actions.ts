"use server";

import { headers } from "next/headers";
import { currentAgentSession } from "@/lib/agents/session";
import { AGENT_SCOPES } from "@/lib/agents/scopes";
import { errorRedirect, parseAuthorizeRequest } from "@/lib/agents/oauth/authorizeRequest";
import { appOriginFromHeaders } from "@/lib/agents/oauth/origin";
import { clientRedirect } from "@/lib/agents/oauth/redirects";
import { issueCode } from "@/lib/agents/oauth/store";
import { requireUser } from "@/lib/auth/requireUser";
import { toActionResult } from "@/lib/server-actions/result";
import { isSpaceId } from "@/lib/spaces/shared";

// =====================================================================
// THE PERSON'S ANSWER on the consent screen. Both answers check the whole
// authorization request again from its query string, so nothing the page
// sent can widen it, and return where the browser goes next: back to the
// client with a code, or with access_denied.
// =====================================================================

async function checkedRequest(query: string) {
  if (currentAgentSession()) throw new Error("Agents cannot grant access.");
  await requireUser();
  const issuer = appOriginFromHeaders(await headers());
  const parsed = await parseAuthorizeRequest(new URLSearchParams(query), issuer);
  if (parsed.kind === "show") throw new Error(parsed.message);
  return { parsed, issuer };
}

// Allows the client the chosen Space (null = all) and scopes
export async function approveAuthorization(query: string, spaceId: string | null, scopes: string[]) {
  return toActionResult(async () => {
    const { parsed, issuer } = await checkedRequest(query);
    if (parsed.kind === "redirect") return { redirectTo: parsed.url };
    if (spaceId !== null && (typeof spaceId !== "string" || !isSpaceId(spaceId))) throw new Error("Choose a valid Space.");
    const chosen = AGENT_SCOPES.filter((scope) => Array.isArray(scopes) && scopes.includes(scope));
    if (chosen.length === 0) throw new Error("Choose at least one thing the agent may do.");
    if (spaceId !== null && chosen.includes("spaces")) throw new Error("Managing Spaces needs access to all Spaces.");
    const { request } = parsed;
    const code = await issueCode({
      clientId: request.client.client_id, spaceId, scopes: chosen,
      redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, resource: request.resource,
    });
    return { redirectTo: clientRedirect(request.redirectUri, { code, state: request.state, iss: issuer }) };
  });
}

// Refuses: the client hears access_denied
export async function denyAuthorization(query: string) {
  return toActionResult(async () => {
    const { parsed, issuer } = await checkedRequest(query);
    if (parsed.kind === "redirect") return { redirectTo: parsed.url };
    const { request } = parsed;
    return { redirectTo: errorRedirect(request.redirectUri, issuer, request.state, "access_denied", "The person declined.") };
  });
}
