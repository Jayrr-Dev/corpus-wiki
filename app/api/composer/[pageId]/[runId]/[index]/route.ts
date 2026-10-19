import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { validateSvg } from "@/lib/composer/svg";
import type { ComposerRun } from "@/lib/composer/types";
import { z } from "zod";
import { cachedSvgResponse } from "@/lib/media/svgResponse";

export async function GET(request: Request, { params }: { params: Promise<{ pageId: string; runId: string; index: string }> }) {
  try { await requireUser(); } catch { return new Response("Not signed in", { status: 401 }); }
  const parsed = z.object({ pageId: z.uuid(), runId: z.uuid(), index: z.enum(["0", "1", "2"]) }).safeParse(await params);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const { pageId, runId, index } = parsed.data;
  const run = await supabaseRpc(getAdminSupabase()).call<ComposerRun | null>("read_composer_run", { p_page_id: pageId });
  const figure = run?.id === runId ? run.composition.figures.find((figure, offset) => (figure.sourceIndex ?? offset) === Number(index)) : null;
  if (figure?.assetId) {
    const { data: asset } = await getAdminSupabase().from("assets").select("id,origin,media_url,source_id,storage_path").eq("id", figure.assetId).single();
    if (!asset) return new Response("Image unavailable", { status: 404 });
    const src = asset.media_url && (asset.media_url.startsWith("https://") || asset.media_url === `/api/assets/${asset.id}/image` || asset.media_url === `/api/assets/${asset.id}/vector` || /^\/composer\/[a-zA-Z0-9._-]+$/.test(asset.media_url)) ? asset.media_url : asset.origin === "generated" ? `/api/assets/${asset.id}/generated` : asset.source_id ? (asset.storage_path.startsWith("figures/") ? `/api/sources/${asset.source_id}/figure?path=${encodeURIComponent(asset.storage_path)}` : `/api/sources/${asset.source_id}/file`) : null;
    if (!src) return new Response("Image unavailable", { status: 404 });
    const target = new URL(src, request.url);
    // Only pass sizing and original-download flags to our own media routes.
    if (src.startsWith("/api/")) for (const key of ["w", "original", "download"]) {
      const value = new URL(request.url).searchParams.get(key);
      if (value !== null) target.searchParams.set(key, value);
    }
    return new Response(null, { status: 307, headers: { Location: src.startsWith("/") ? `${target.pathname}${target.search}` : src, "Cache-Control": "private, no-store" } });
  }
  const svg = figure?.svg;
  if (!svg || validateSvg(svg).length) return new Response("Illustration unavailable", { status: 404 });
  return cachedSvgResponse(request, svg);
}
