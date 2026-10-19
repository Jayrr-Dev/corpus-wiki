import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { SPACE_COOKIE } from "@/lib/spaces/shared";
import { safeNextPath } from "@/lib/auth/paths";

// The default Supabase confirmation email uses the PKCE code flow. Token-hash
// links also work if a custom email template points directly at this route.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const client = await getServerSupabase();
  const result = code ? await client.auth.exchangeCodeForSession(code)
    : hash && (type === "email" || type === "signup" || type === "invite")
      ? await client.auth.verifyOtp({ token_hash: hash, type }) : null;
  if (!result || result.error) return NextResponse.redirect(new URL("/login?confirmation=failed", url.origin));
  (await cookies()).delete(SPACE_COOKIE);
  return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin));
}
