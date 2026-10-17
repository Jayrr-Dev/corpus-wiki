import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { supabaseRpc } from "@/lib/db/rpc";
import { validateSvg } from "@/lib/composer/svg";
import type { ComposerRun } from "@/lib/composer/types";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string; runId: string; index: string }> }) {
  try { await requireUser(); } catch { return new Response("Not signed in", { status: 401 }); }
  const parsed = z.object({ pageId: z.uuid(), runId: z.uuid(), index: z.enum(["0", "1", "2"]) }).safeParse(await params);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const { pageId, runId, index } = parsed.data;
  const run = await supabaseRpc(getAdminSupabase()).call<ComposerRun | null>("read_composer_run", { p_page_id: pageId });
  const figure = run?.id === runId ? run.composition.figures[Number(index)] : null;
  if (figure?.assetId) {
    const { data: asset } = await getAdminSupabase().from("assets").select("id,origin,media_url,source_id,storage_path").eq("id", figure.assetId).single();
    if (!asset) return new Response("Image unavailable", { status: 404 });
    const src = asset.media_url && (asset.media_url.startsWith("https://") || asset.media_url === `/api/assets/${asset.id}/image` || asset.media_url === `/api/assets/${asset.id}/vector` || /^\/composer\/[a-zA-Z0-9._-]+$/.test(asset.media_url)) ? asset.media_url : asset.origin === "generated" ? `/api/assets/${asset.id}/generated` : asset.source_id ? (asset.storage_path.startsWith("figures/") ? `/api/sources/${asset.source_id}/figure?path=${encodeURIComponent(asset.storage_path)}` : `/api/sources/${asset.source_id}/file`) : null;
    if (!src) return new Response("Image unavailable", { status: 404 });
    return new Response(null, { status: 307, headers: { Location: src, "Cache-Control": "private, no-store" } });
  }
  const svg = figure?.svg;
  if (!svg || validateSvg(svg).length) return new Response("Illustration unavailable", { status: 404 });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" } });
}
