import "server-only";

import { z } from "zod";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import { type Coverage, isCompleteScope, isCoverage, loadScopeClaims, loadScopeOptions, pickCoverage, type Scope, SCOPE_KIND_LABELS, SCOPE_KINDS, scopeTitle } from "@/lib/knowledge/scope";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/requireUser";
import { moduleOffResponse } from "@/lib/modules";
import { chatOutlineModel, type OutlineClaim, type OutlineModel } from "./generate";
import { docOutlineSchema } from "./outline";
import type { DocSetSummary, DocSetView } from "./types";

// =====================================================================
// DOCS ON THE SERVER: scope claims for an outline, the doc set reads and
// the request shapes the /api/docs routes accept.
// =====================================================================

export const adminDb = (): DbRpc => supabaseRpc(getAdminSupabase());

// ROUTE GUARD for /api/docs: same origin (writes), signed in, and the Docs module on
export async function docsRouteGuard(request: Request, write: boolean): Promise<Response | null> {
  const origin = request.headers.get("origin");
  if (write && origin && origin !== new URL(request.url).origin) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  try { await requireUser(); }
  catch { return Response.json({ ok: false, error: "Sign in to use Docs." }, { status: 401 }); }
  return moduleOffResponse("docs");
}

export const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export const scopeSchema = z.object({ kind: z.enum(SCOPE_KINDS), id: z.string().nullish() }).refine((scope) => isCompleteScope(scope as Scope), "Choose a source.").transform((scope) => scope as Scope);
export const coverageSchema = z.number().refine(isCoverage, "Coverage is 25, 50 or 100.").transform((value) => value as Coverage);
export const outlineRequestSchema = z.object({ scope: scopeSchema, coverage: coverageSchema });
export const createRequestSchema = outlineRequestSchema.extend({ outline: docOutlineSchema });

// The scope's name, for the default set title
async function scopeLabel(scope: Scope): Promise<string> {
  if (scope.kind === "glossary" && !scope.id) return SCOPE_KIND_LABELS.glossary;
  return scopeTitle(scope, await loadScopeOptions(), SCOPE_KIND_LABELS[scope.kind]);
}

// The claims a doc set is written from: the scope's, most central first, cut to the coverage
export async function loadDocsClaims(scope: Scope, coverage: Coverage): Promise<{ title: string; claims: OutlineClaim[] }> {
  const [title, claims] = await Promise.all([scopeLabel(scope), loadScopeClaims(scope)]);
  return { title, claims: pickCoverage(claims, coverage).map((claim) => ({ unitId: claim.unitId, title: claim.title, content: claim.content })) };
}

// The Docs writer's outline model when AI is configured (null: the plain fallback outline)
export async function outlineModel(db: DbRpc = adminDb()): Promise<OutlineModel | null> {
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
  return settings ? chatOutlineModel(settings) : null;
}

export async function listDocSets(db: DbRpc = adminDb()): Promise<DocSetSummary[]> {
  return (await db.call<DocSetSummary[] | null>("list_doc_sets")) ?? [];
}

export async function readDocSet(id: string, db: DbRpc = adminDb()): Promise<DocSetView | null> {
  if (!z.uuid().safeParse(id).success) return null;
  return db.call<DocSetView | null>("read_doc_set", { p_doc_set_id: id });
}
