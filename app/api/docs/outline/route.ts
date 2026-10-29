import { proposeOutline } from "@/lib/docs/generate";
import { docsRouteGuard, errorMessage, loadDocsClaims, outlineModel, outlineRequestSchema } from "@/lib/docs/server";

// PROPOSE AN OUTLINE (New docs dialog): the Docs writer plans page titles from the scope's
// claims; nothing is saved until the person approves it with Write docs.
export async function POST(request: Request): Promise<Response> {
  const blocked = await docsRouteGuard(request, true);
  if (blocked) return blocked;
  const parsed = outlineRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  try {
    const { title, claims } = await loadDocsClaims(parsed.data.scope, parsed.data.coverage);
    if (!claims.length) return Response.json({ ok: false, error: "This source has no claims yet." }, { status: 422 });
    const outline = await proposeOutline(await outlineModel(), title, claims);
    return Response.json({ ok: true, outline, claimCount: claims.length });
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, "Could not plan the docs.") }, { status: 500 });
  }
}
