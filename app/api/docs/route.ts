import { after } from "next/server";
import { writeDocPages } from "@/lib/docs/generate";
import { normalizeOutline } from "@/lib/docs/outline";
import { adminDb, createRequestSchema, docsRouteGuard, errorMessage, loadDocsClaims } from "@/lib/docs/server";
import { getServerDeps } from "@/lib/server/deps";

// WRITE DOCS (New docs dialog): saves the approved outline as a doc set and its pages,
// answers at once, then writes the pages after the response through the living page.
export async function POST(request: Request): Promise<Response> {
  const blocked = await docsRouteGuard(request, true);
  if (blocked) return blocked;
  const parsed = createRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const { scope, coverage } = parsed.data;
  try {
    // The outline came back from the browser: keep only claims this scope still has
    const { title, claims } = await loadDocsClaims(scope, coverage);
    const outline = normalizeOutline(parsed.data.outline, claims.map((claim) => claim.unitId), title);
    if (!outline.pages.length) return Response.json({ ok: false, error: "Keep at least one page." }, { status: 422 });
    const db = adminDb();
    const created = await db.call<{ docSetId: string; pageIds: string[] }>("create_doc_set", {
      p_title: outline.title, p_scope_kind: scope.kind, p_scope_id: scope.id ?? null, p_coverage: coverage, p_pages: outline.pages,
    });
    const { writer } = await getServerDeps();
    after(() => writeDocPages(db, writer, created.docSetId, created.pageIds).catch((error) => console.error("Writing docs failed", error)));
    return Response.json({ ok: true, id: created.docSetId });
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, "Could not write the docs.") }, { status: 500 });
  }
}
