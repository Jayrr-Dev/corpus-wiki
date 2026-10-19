import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { optimizedMediaResponse } from "@/lib/media/optimize";
import { replaceStoredMedia } from "@/lib/media/replace";

// =====================================================================
// A SOURCE'S ORIGINAL FILE: redirects to a short-lived signed URL in the
// private 'sources' bucket, so <iframe>, <img>, <video> and fetch() can all
// read it (range requests included). ?download=1 asks for an attachment.
// Signed-in sessions only; the source row is read as the user (RLS).
// =====================================================================

const SIGNED_URL_SECONDS = 60 * 10;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireUser();
  } catch {
    return new Response("Sign in to read source files.", { status: 401 });
  }
  const { id } = await params;
  const { data: source } = await (await getServerSupabase()).from("sources").select("title, storage_path, mime_type").eq("id", id).maybeSingle();
  if (!source?.storage_path) return new Response("No file for this source.", { status: 404 });

  const isDownload = new URL(request.url).searchParams.has("download");
  const optimized = await optimizedMediaResponse(request, { bucket: "sources", path: source.storage_path, mime: source.mime_type, replace: (bytes, mime) => replaceStoredMedia("sources", source.storage_path, bytes, mime), download: async () => {
    const result = await getAdminSupabase().storage.from("sources").download(source.storage_path);
    if (result.error || !result.data) throw new Error("Source media unavailable");
    return result.data;
  } });
  if (optimized) return optimized;
  const { data, error } = await getAdminSupabase()
    .storage.from("sources")
    .createSignedUrl(source.storage_path, SIGNED_URL_SECONDS, isDownload ? { download: source.title } : undefined);
  if (error || !data) return new Response(`Could not open the file: ${error?.message ?? "unknown error"}`, { status: 502 });
  return Response.redirect(data.signedUrl, 302);
}
