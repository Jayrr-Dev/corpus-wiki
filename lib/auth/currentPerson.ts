import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { forgetRequestClaims, requestClaims } from "@/lib/auth/claims";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSpaceId, SPACE_COOKIE } from "@/lib/spaces/shared";

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
export type Actor = { personId: string | null; via: Via; spaceId?: string | null };

// One lookup per request: keyed by the request's cookie store
const byRequest = new WeakMap<object, Promise<Actor>>();

// Selecting a space mutates the cookie before Next renders the action response.
// Let that render resolve the new selection; settled background runs keep theirs.
export async function resetRequestActor(): Promise<void> {
  byRequest.delete(await cookies());
  await forgetRequestClaims();
}

// A LONG RUN (an upload's workflow) settles its actor once, at its start. In `next dev`
// the request's cookies() promise belongs to a render stage: read again minutes later,
// after the stage has moved on, it can never resolve, and every database call behind it
// (they all name their actor) would hang with it.
const settledActor = new AsyncLocalStorage<Actor>();
export function withSpaceActor<T>(actor: Actor, run: () => Promise<T>): Promise<T> {
  return settledActor.run(actor, run);
}
export async function withSettledActor<T>(run: () => Promise<T>): Promise<T> {
  return settledActor.run(await currentActor(), run);
}

export async function currentActor(): Promise<Actor> {
  const settled = settledActor.getStore();
  if (settled) return settled;
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return { personId: null, via: "script" };
  }
  let actor = byRequest.get(store);
  if (!actor) {
    const selected = store.get(SPACE_COOKIE)?.value;
    actor = readPersonId().then(async (personId): Promise<Actor> => {
      let spaceId = personId && selected && isSpaceId(selected) ? selected : null;
      if (personId && !spaceId) {
        const { data, error } = await (await getServerSupabase()).from("spaces").select("id").order("created_at").order("id").limit(1).maybeSingle();
        if (error) throw new Error(error.message);
        spaceId = data?.id ?? null;
      }
      return { personId, via: personId ? "app" : "api", spaceId };
    });
    byRequest.set(store, actor);
  }
  return actor;
}

async function readPersonId(): Promise<string | null> {
  const { data, error } = await requestClaims();
  // An unavailable/invalid auth service must never turn a person's request
  // into a trusted script targeting the original account's data.
  if (error && error.name !== "AuthSessionMissingError") throw error;
  return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
}
