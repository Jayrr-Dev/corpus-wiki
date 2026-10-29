import { notFound } from "next/navigation";
import { z } from "zod";
import { ReadingPane } from "@/components/shell";
import { requireModule } from "@/lib/modules";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { checkOverdue } from "@/lib/video/pipeline";
import { pipelineDeps, signedVideoUrl, videoRates } from "@/lib/video/server";
import { isWorking } from "@/lib/video/status";
import { StatusChip } from "../StatusChip";
import { VideoDetail, type AssetChoice } from "./VideoDetail";

export const dynamic = "force-dynamic";

// Images from Assets the image visual can show
async function imageAssets(): Promise<AssetChoice[]> {
  const { data } = await getAdminSupabase().from("assets").select("id,title").eq("kind", "image").is("deleted_at", null).order("created_at", { ascending: false }).limit(60);
  return (data ?? []).map((asset) => ({ id: asset.id, label: asset.title || "Untitled image" }));
}

// ONE VIDEO (/video/[id]): the script to check and edit, then progress, the player, or the error
export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("video");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const deps = await pipelineDeps();
  const found = await deps.store.get(id.data);
  if (!found) notFound();
  const video = isWorking(found.status) ? await checkOverdue(deps, found) : found;
  const slug = video.title.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";
  const [assets, playUrl, posterUrl, downloadUrl] = await Promise.all([
    video.status === "script" ? imageAssets() : Promise.resolve([]),
    video.status === "ready" ? signedVideoUrl(video.videoPath) : null,
    video.status === "ready" ? signedVideoUrl(video.posterPath) : null,
    video.status === "ready" ? signedVideoUrl(video.videoPath, `${slug}.mp4`) : null,
  ]);
  return (
    <ReadingPane title={video.title} width="prose" actions={<StatusChip status={video.status} />}>
      <VideoDetail video={video} rates={videoRates()} assets={assets} media={{ playUrl, posterUrl, downloadUrl }} />
    </ReadingPane>
  );
}
