"use server";

import { after } from "next/server";
import { z } from "zod";
import { currentActor, withSpaceActor } from "@/lib/auth/currentPerson";
import { requireUser } from "@/lib/auth/requireUser";
import { abortSuggestionApply } from "@/lib/suggestions/run";
import { drainSuggestionWork, startSuggestionWorker } from "@/lib/suggestions/worker";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// ARTICLE SUGGESTIONS (/units?view=suggestions). Each action only
// records the request; the work runs as a leased job, started at once
// after the response and resumed by the background worker if it stops.
// =====================================================================

// Start the job now, in the caller's space, without holding the response
async function startWork() {
  const actor = await currentActor();
  after(() => withSpaceActor(actor, () => {
    startSuggestionWorker();
    return drainSuggestionWork();
  }).then(() => undefined).catch((error) => console.error("Article suggestions could not run:", error)));
}

const runScope = z.object({
  domainId: z.string().uuid().nullable(),
  unitIds: z.array(z.string().uuid()).max(5000).optional(),
  kind: z.enum(["create", "merge"]).optional(),
});

// RUN: queue a run over unused knowledge. Optional domain, claim list, and one kind.
export async function runArticleSuggestions(
  domainId: string | null,
  options?: { unitIds?: string[]; kind?: "create" | "merge" },
): Promise<ActionResult<{ runId: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const scope = runScope.parse({ domainId, ...options });
    const { data, error } = await getAdminSupabase().from("suggestion_runs").insert({ requested_by: user.id, scope }).select("id").single();
    if (error) throw new Error(error.code === "23505" ? "A suggestion run is already in progress." : error.message);
    await startWork();
    return { runId: data.id };
  });
}

// ACCEPT: optionally with an edited title for a new article; applied by the job
export async function acceptArticleSuggestion(id: string, title?: string): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(150).optional() }).parse({ id, title });
    const client = getAdminSupabase();
    const { data: current, error: readError } = await client.from("article_suggestions").select("kind").eq("id", parsed.id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("This suggestion no longer exists.");
    const retitle = parsed.title && current.kind === "create" ? { title: parsed.title } : {};
    const { data, error } = await client.from("article_suggestions")
      .update({ status: "accepting", note: null, attempts: 0, decided_at: new Date().toISOString(), decided_by: user.id, ...retitle })
      .eq("id", parsed.id).in("status", ["pending", "failed"]).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("This suggestion was already answered.");
    await startWork();
    return {};
  });
}

// ACCEPT ALL: every open suggestion, applied by the same job as a single accept
export async function acceptAllArticleSuggestions(): Promise<ActionResult<{ accepted: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const actor = await currentActor();
    if (!actor.spaceId) throw new Error("Choose a space first.");
    const { data, error } = await getAdminSupabase().from("article_suggestions")
      .update({ status: "accepting", note: null, attempts: 0, decided_at: new Date().toISOString(), decided_by: user.id })
      .eq("space_id", actor.spaceId).in("status", ["pending", "failed"]).select("id");
    if (error) throw new Error(error.message);
    if (data?.length) await startWork();
    return { accepted: data?.length ?? 0 };
  });
}

// CANCEL: stop an apply that is still running and leave it failed, so it can be retried or dismissed
export async function cancelArticleSuggestion(id: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const { data, error } = await getAdminSupabase().from("article_suggestions")
      .update({ status: "failed", note: "Cancelled.", lease_token: null, lease_until: null })
      .eq("id", z.string().uuid().parse(id)).eq("status", "accepting").select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("This suggestion is no longer applying.");
    abortSuggestionApply(id);
    return {};
  });
}

// DISMISS: the same group is not suggested again until its knowledge changes
export async function dismissArticleSuggestion(id: string): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const { data, error } = await getAdminSupabase().from("article_suggestions")
      .update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by: user.id })
      .eq("id", z.string().uuid().parse(id)).in("status", ["pending", "failed", "stale"]).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("This suggestion was already answered.");
    return {};
  });
}
