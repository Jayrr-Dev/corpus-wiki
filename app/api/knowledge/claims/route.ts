import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { knowledgeLabel } from "@/lib/knowledge/label";
import { loadScopeClaims } from "@/lib/knowledge/scope";
import { isCompleteScope, SCOPE_KINDS, type Scope } from "@/lib/knowledge/scopeTypes";

// CLAIMS FOR A SOURCE (Coverage: Custom): the live claims of a source, most central first.
// Titles only, so the list stays short; the full text is not sent.
const querySchema = z.object({ kind: z.enum(SCOPE_KINDS), id: z.string().nullish() })
  .refine((scope) => isCompleteScope(scope as Scope), "Choose a source.");

export async function GET(request: Request): Promise<Response> {
  try { await requireUser(); }
  catch { return Response.json({ ok: false, error: "Sign in to choose claims." }, { status: 401 }); }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ kind: url.searchParams.get("kind"), id: url.searchParams.get("id") });
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Choose a source." }, { status: 400 });
  try {
    const claims = await loadScopeClaims(parsed.data as Scope);
    return Response.json({ ok: true, claims: claims.map((claim) => ({ unitId: claim.unitId, title: claim.title?.trim() || knowledgeLabel(claim.content) })) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error && error.message ? error.message : "Could not load the claims." }, { status: 500 });
  }
}
