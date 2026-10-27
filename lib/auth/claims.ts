import "server-only";

import { cookies } from "next/headers";
import { getServerSupabase, type ServerSupabase } from "@/lib/supabase/server";

type ClaimsResult = Awaited<ReturnType<ServerSupabase["auth"]["getClaims"]>>;

// One verified read of the session per request (requireUser, currentActor and the
// layout all ask): keyed by the request's cookie store, like currentActor
const byRequest = new WeakMap<object, Promise<ClaimsResult>>();

// The request's verified JWT claims (getClaims checks the signature), read once
export async function requestClaims(): Promise<ClaimsResult> {
  const store = await cookies();
  let claims = byRequest.get(store);
  if (!claims) {
    claims = getServerSupabase().then((client) => client.auth.getClaims());
    byRequest.set(store, claims);
  }
  return claims;
}

// Signing in or out changes who this request is; read the claims again after it
export async function forgetRequestClaims(): Promise<void> {
  byRequest.delete(await cookies());
}
