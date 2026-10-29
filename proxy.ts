import { NextResponse, type NextRequest } from "next/server";
import { hasPublicSupabaseEnv } from "@/lib/supabase/env";
import { isMarketingPath, isPublicPath, isPublicWikiPath, refreshSession } from "@/lib/supabase/proxy";

// AUTH GATE (Next 16 "proxy", formerly middleware): signed-out users go to /login
export async function proxy(request: NextRequest) {
  if (isMarketingPath(request.nextUrl.pathname)) return NextResponse.next();
  // Public readers never resolve a signed-in workspace or refresh its cookies.
  if (isPublicWikiPath(request.nextUrl.pathname)) {
    // Server Actions can be posted to page URLs. The public reader is a strict
    // GET/HEAD surface, even if a caller knows a workspace action identifier.
    if (request.nextUrl.pathname !== "/api/public-wiki/metrics" && !["GET", "HEAD"].includes(request.method)) {
      return new NextResponse(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
    }
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("CDN-Cache-Control", "no-store");
    response.headers.set("Vercel-CDN-Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
  }
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
