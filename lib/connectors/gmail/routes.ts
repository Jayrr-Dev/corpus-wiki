import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { isFeatureEnabled } from "@/lib/flags/server";
import { openTokens, sealTokens, tokenKeyFrom } from "./crypto";
import { authorizationUrl, newAuthAttempt } from "./oauth";
import { googleClient, missingGmailEnv, serverGmailService } from "./server";

// =====================================================================
// GMAIL OAUTH ROUTES
//   GET /api/gmail/connect   sends the signed-in person to Google's consent
//                            screen (gmail.readonly only)
//   GET /api/gmail/callback  Google sends them back with a one-time code;
//                            the tokens are sealed and stored server side
// Both are a plain 404 while the gmail_import flag is off. The state and
// PKCE verifier travel in a sealed, httpOnly cookie bound to the person.
// =====================================================================

export const ATTEMPT_COOKIE = "gmail_oauth_attempt";
const ATTEMPT_MAX_AGE_S = 10 * 60;

type Attempt = { state: string; verifier: string; createdAt: number };

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}

// Back to Settings > Gmail, with what happened as a short code
function backToSettings(request: NextRequest, outcome: "connected" | "denied" | "failed" | "setup"): NextResponse {
  const url = new URL("/settings", request.nextUrl.origin);
  url.searchParams.set("gmail", outcome);
  url.hash = "gmail";
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: ATTEMPT_COOKIE, path: "/api/gmail" });
  return response;
}

async function signedInId(): Promise<string | null> {
  try {
    return (await requireUser()).id;
  } catch {
    return null;
  }
}

export async function handleConnect(request: NextRequest): Promise<Response> {
  if (!(await isFeatureEnabled("gmail_import"))) return notFound();
  const personId = await signedInId();
  if (!personId) return new Response("Sign in first.", { status: 401 });
  if (missingGmailEnv().length) return backToSettings(request, "setup");
  const attempt = newAuthAttempt();
  const sealed = sealTokens(tokenKeyFrom(process.env.GMAIL_TOKEN_KEY), personId, { ...attempt, createdAt: Date.now() } satisfies Attempt);
  const response = NextResponse.redirect(authorizationUrl(googleClient(request.nextUrl.origin), attempt));
  response.cookies.set({ name: ATTEMPT_COOKIE, value: sealed, httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/gmail", maxAge: ATTEMPT_MAX_AGE_S });
  return response;
}

export async function handleCallback(request: NextRequest): Promise<Response> {
  if (!(await isFeatureEnabled("gmail_import"))) return notFound();
  const personId = await signedInId();
  if (!personId) return new Response("Sign in first.", { status: 401 });
  if (missingGmailEnv().length) return backToSettings(request, "setup");
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return backToSettings(request, "denied");
  const code = params.get("code");
  const state = params.get("state");
  const sealed = request.cookies.get(ATTEMPT_COOKIE)?.value;
  if (!code || !state || !sealed) return backToSettings(request, "failed");
  try {
    const attempt = openTokens<Attempt>(tokenKeyFrom(process.env.GMAIL_TOKEN_KEY), personId, sealed);
    if (!sameText(attempt.state, state) || Date.now() - attempt.createdAt > ATTEMPT_MAX_AGE_S * 1000) return backToSettings(request, "failed");
    await serverGmailService(request.nextUrl.origin).completeConnect(personId, code, attempt.verifier);
    return backToSettings(request, "connected");
  } catch (error) {
    console.error("Gmail could not be connected:", error);
    return backToSettings(request, "failed");
  }
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
