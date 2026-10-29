"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { VideoRow, VideoStatus } from "@/lib/video/types";

type StatusReply = { status: VideoStatus; error: string | null; progress: { step: string; percent: number } };

const POLL_MS = 4000;

// VOICING / RENDERING: a progress bar with the step name; polls the status route (which also runs
// the timeout check) and reloads the page when the video moves on
export function VideoProgress({ video }: { video: VideoRow }) {
  const router = useRouter();
  const status = useQuery({
    queryKey: ["video-status", video.id],
    queryFn: async (): Promise<StatusReply> => {
      const response = await fetch(`/api/video/${video.id}/status`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not check the video.");
      return (await response.json()) as StatusReply;
    },
    refetchInterval: POLL_MS,
  });
  const current = status.data?.status ?? video.status;
  useEffect(() => {
    if (current !== video.status) router.refresh();
  }, [current, video.status, router]);

  const voiced = video.script.scenes.filter((scene) => scene.audioPath).length;
  const progress = status.data?.progress ?? { step: video.status === "voicing" ? `Voicing scene ${Math.min(voiced + 1, video.script.scenes.length)} of ${video.script.scenes.length}` : "Rendering", percent: video.status === "voicing" ? 0 : 50 };
  return (
    <div className="flex flex-col gap-3 rounded-xl border px-4 py-4">
      <div className="flex items-center justify-between gap-3 text-panel">
        <span className="font-medium">{progress.step}</span>
        <span className="text-muted-foreground tabular-nums">{progress.percent}%</span>
      </div>
      <div role="progressbar" aria-label={progress.step} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-(--share) rounded-full bg-link transition-all duration-700" style={{ "--share": `${progress.percent}%` } as React.CSSProperties} />
      </div>
      <p className="text-panel text-muted-foreground">You can leave this page.</p>
    </div>
  );
}
