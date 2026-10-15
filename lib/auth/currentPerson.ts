import "server-only";

import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";

// =====================================================================
// WHO IS ACTING on this request, so every change can name who made it.
// The admin client sends it to the database on each call
// (lib/supabase/admin.ts); triggers stamp the person's profile id onto
// the rows written (supabase/migrations/20261031000000_profiles.sql).
// =====================================================================

// Where a request came from: the app (a signed-in person), an API-key
// capture (the proxy lets only /api/capture through signed out), or a
// script / test with no request at all
export type Via = "app" | "api" | "script";
export type Actor = { personId: string | null; via: Via };

// One lookup per request: keyed by the request's cookie store
const byRequest = new WeakMap<object, Promise<Actor>>();

export async function currentActor(): Promise<Actor> {
  let store: object;
  try {
    store = await cookies();
  } catch {
    return { personId: null, via: "script" };
  }
  let actor = byRequest.get(store);
  if (!actor) {
    actor = readPersonId().then((personId) => ({ personId, via: personId ? "app" : "api" }));
    byRequest.set(store, actor);
  }
  return actor;
}

async function readPersonId(): Promise<string | null> {
  try {
    const { data } = await (await getServerSupabase()).auth.getClaims();
    return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  } catch {
    return null;
  }
}
