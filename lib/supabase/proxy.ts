import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database/types";
import { getPublicSupabaseEnv } from "./env";
import { isSpaceId, SPACE_COOKIE } from "@/lib/spaces/shared";

// ROUTES THE PROXY LETS THROUGH WITHOUT A SESSION. /api/capture checks the
// caller itself (session or API key); /api/mcp checks its agent token and /.well-known/oauth-protected-resource tells clients where to sign in; /api/processing/recover requires its own
// worker key; /api/billing/webhook checks Stripe's signature. / is the public landing page, /pricing its price list, and /landing-demos holds the
// static demos it embeds. Scripts and schedulers have
// no cookie to redirect; every other route, future /api routes included, stays behind sign-in.
// /oauth and the authorization server metadata serve MCP clients, which have no
// cookie; /oauth/authorize sends a signed-out person to /login itself, keeping the request.
export const PUBLIC_PATHS = ["/", "/landing-demos", "/privacy", "/terms", "/contact", "/login", "/signup", "/auth/callback", "/api/capture", "/api/mcp", "/.well-known/oauth-protected-resource", "/api/processing/recover", "/api/billing/webhook", "/explore", "/s", "/embed", "/api/public-wiki/metrics", "/api/public-wiki/thumbnail", "/oauth", "/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"] as const;

// The marketing page and the static demos it embeds never read a session, so the
// proxy skips the auth refresh for them: a slow or down auth service can't break them.
export function isMarketingPath(pathname: string): boolean {
  // /privacy, /terms and /contact are the legal pages (/contact is a 404 without a contact address); /pricing is a 404 while billing is off
  return ["/", "/landing-demos", "/privacy", "/terms", "/contact", "/pricing"].some(p => pathname === p || pathname.startsWith(`${p}/`));
}

export function isPublicWikiPath(pathname: string): boolean {
  return ["/explore", "/s", "/embed", "/api/public-wiki/metrics", "/api/public-wiki/thumbnail"].some(p => pathname === p || pathname.startsWith(`${p}/`));
}

// The render job's callback (/api/video/<id>/rendered) has no cookie; it checks its own signed token
const VIDEO_RENDER_CALLBACK = /^\/api\/video\/[^/]+\/rendered$/;

// True when the path is a public route (or below one)
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || VIDEO_RENDER_CALLBACK.test(pathname);
}

// Refreshes the auth session cookie and returns the response plus whether a user is signed in.
// Uses getClaims() (verifies the JWT) rather than getSession(), which trusts the cookie as-is.
export async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = getPublicSupabaseEnv();
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const selected = request.cookies.get(SPACE_COOKIE)?.value;
  // The ownership read runs beside the claims check; RLS answers it with the same
  // session, and its result counts only once the claims are verified
  const [{ data }, owned] = await Promise.all([
    supabase.auth.getClaims(),
    selected && isSpaceId(selected)
      ? supabase.from("spaces").select("id").eq("id", selected).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (data?.claims && selected) {
    if (owned.error) throw new Error(owned.error.message);
    if (!owned.data) {
      request.cookies.delete(SPACE_COOKIE);
      const refreshedCookies = response.cookies.getAll();
      response = NextResponse.next({ request });
      refreshedCookies.forEach((cookie) => response.cookies.set(cookie));
      response.cookies.delete(SPACE_COOKIE);
    }
  }
  return { response, isSignedIn: Boolean(data?.claims) };
}
