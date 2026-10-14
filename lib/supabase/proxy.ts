import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database/types";
import { getPublicSupabaseEnv } from "./env";

// ROUTES ANYONE MAY OPEN WITHOUT SIGNING IN
export const PUBLIC_PATHS = ["/login"] as const;

// True when the path is a public route (or below one)
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
  const { data } = await supabase.auth.getClaims();
  return { response, isSignedIn: Boolean(data?.claims) };
}
