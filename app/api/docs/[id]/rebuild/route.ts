import { after } from "next/server";
import { z } from "zod";
import { writeDocPages } from "@/lib/docs/generate";
import { adminDb, docsRouteGuard, errorMessage } from "@/lib/docs/server";
import { getServerDeps } from "@/lib/server/deps";

const bodySchema = z.object({ pageId: z.uuid().optional() }).nullable();

// REBUILD (reader top bar) or REBUILD PAGE (a stale page): rewrites the lines whose claims
// changed and writes any claim not yet covered, after the response, like an article rebuild.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const blocked = await docsRouteGuard(request, true);
  if (blocked) return blocked;
  const id = z.uuid().safeParse((await params).id);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  try {
    const db = adminDb();
    const pageIds = await db.call<string[]>("list_doc_set_pages", { p_doc_set_id: id.data });
    const pageId = body.data?.pageId;
    const pages = pageId ? pageIds.filter((page) => page === pageId) : pageIds;
    if (!pages.length) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
    const { writer } = await getServerDeps();
    after(() => writeDocPages(db, writer, id.data, pages).catch((error) => console.error("Rebuilding docs failed", error)));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, "Could not rebuild.") }, { status: 500 });
  }
}
