"use client";

import { useRouter } from "next/navigation";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import type { CostRates } from "@/lib/video/cost";
import type { VideoRow } from "@/lib/video/types";
import { retryVideo } from "../actions";
import { ScriptEditor } from "./ScriptEditor";
import { VideoProgress } from "./VideoProgress";
import { VideoReady } from "./VideoReady";

export type AssetChoice = { id: string; label: string };
export type VideoMedia = { playUrl: string | null; posterUrl: string | null; downloadUrl: string | null };

// THE VIDEO SCREEN for each status: Script (edit, then Make video), Voicing / Rendering (progress),
// Ready (player, chapters, sources) and Failed (the error and Try again)
export function VideoDetail({ video, rates, assets, media }: { video: VideoRow; rates: CostRates; assets: AssetChoice[]; media: VideoMedia }) {
  switch (video.status) {
    case "script":
      // remount with the saved script after a save or rewrite
      return <ScriptEditor key={`${video.title}:${JSON.stringify(video.script)}`} video={video} rates={rates} assets={assets} />;
    case "voicing":
    case "rendering":
      return <VideoProgress video={video} />;
    case "ready":
      return <VideoReady video={video} media={media} />;
    case "failed":
      return <VideoFailed video={video} />;
  }
}

// FAILED: the error in plain words, and Try again (scenes already voiced are kept)
function VideoFailed({ video }: { video: VideoRow }) {
  const router = useRouter();
  const retry = useServerAction(retryVideo, { progress: false, refreshTables: [] });
  const run = async () => {
    const result = await retry.run(video.id);
    if (result.ok) router.refresh();
  };
  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
        <p className="font-medium">This video could not be made.</p>
        <p className="mt-1 text-panel whitespace-pre-wrap break-words text-muted-foreground">{video.error || "Something went wrong."}</p>
      </div>
      <ErrorNote error={retry.error} />
      <div><Button type="button" onClick={run} disabled={retry.isPending}>{retry.isPending ? "Starting…" : "Try again"}</Button></div>
    </div>
  );
}
