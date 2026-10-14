import { NextResponse, type NextRequest } from "next/server";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { isPublicPath, refreshSession } from "@/lib/supabase/proxy";

// AUTH GATE (Next 16 "proxy", formerly middleware): signed-out users go to /login
export async function proxy(request: NextRequest) {
  // Without Supabase settings there is no login to check; fail closed to /login
  if (!hasPublicSupabaseEnv()) return redirectUnlessPublic(request);
  const { response, isSignedIn } = await refreshSession(request);
  if (isSignedIn || isPublicPath(request.nextUrl.pathname)) return response;
  return redirectToLogin(request);
}

// Sends the visitor to /login, remembering where they were going
function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

// Lets public paths through and redirects the rest
function redirectUnlessPublic(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  return redirectToLogin(request);
}

// RUN ON PAGES ONLY: skip Next internals and static files
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
