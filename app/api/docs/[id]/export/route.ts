import { docSetExportFiles, docSlug } from "@/lib/docs/markdown";
import { docsRouteGuard, errorMessage, readDocSet } from "@/lib/docs/server";
import { zipFiles } from "@/lib/docs/zip";

// EXPORT (reader top bar): the doc set as a zip of Markdown files, one per page
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const blocked = await docsRouteGuard(request, false);
  if (blocked) return blocked;
  try {
    const set = await readDocSet((await params).id);
    if (!set) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
    const zip = zipFiles(docSetExportFiles(set));
    return new Response(zip.buffer as ArrayBuffer, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${docSlug(set.title)}-docs.zip"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, "Could not export.") }, { status: 500 });
  }
}
