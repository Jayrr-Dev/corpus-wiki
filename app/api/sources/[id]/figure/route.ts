import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { optimizedMediaResponse } from "@/lib/media/optimize";
import { replaceStoredMedia } from "@/lib/media/replace";

// =====================================================================
// A PICTURE EMBEDDED IN A SOURCE (a .docx figure): redirects to a short-lived
// signed URL for ?path=, like the source's own file. Only a path one of this
// source's passages names (location.figure) is served, read as the user (RLS).
// =====================================================================

const SIGNED_URL_SECONDS = 60 * 10;
const FIGURE_PATH = /^figures\/[0-9a-f]{64}\.(?:png|jpg|gif|webp)$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireUser();
  } catch {
    return new Response("Sign in to read source files.", { status: 401 });
  }
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!FIGURE_PATH.test(path)) return new Response("That is not a figure.", { status: 400 });
  const { data: passage } = await (await getServerSupabase()).from("passages").select("id").eq("source_id", id).eq("location->>figure", path).limit(1).maybeSingle();
  if (!passage) return new Response("No such figure in this source.", { status: 404 });
  const optimized = await optimizedMediaResponse(request, { bucket: "sources", path, mime: "image/png", replace: (bytes, mime) => replaceStoredMedia("sources", path, bytes, mime), download: async () => {
    const result = await getAdminSupabase().storage.from("sources").download(path);
    if (result.error || !result.data) throw new Error("Figure unavailable");
    return result.data;
  } });
  if (optimized) return optimized;

  const { data, error } = await getAdminSupabase().storage.from("sources").createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) return new Response(`Could not open the figure: ${error?.message ?? "unknown error"}`, { status: 502 });
  return Response.redirect(data.signedUrl, 302);
}
