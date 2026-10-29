"use client";

import Link from "next/link";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { scriptSources } from "@/lib/video/script";
import { formatDuration, type VideoRow } from "@/lib/video/types";
import type { VideoMedia } from "./VideoDetail";

// READY: the player, Download, a chapter per scene and the claims the video cites
export function VideoReady({ video, media }: { video: VideoRow; media: VideoMedia }) {
  const player = useRef<HTMLVideoElement | null>(null);
  const chapters = video.script.scenes.map((scene, index) => ({
    id: scene.id,
    title: scene.title,
    start: video.script.scenes.slice(0, index).reduce((sum, before) => sum + (before.durationMs ?? 0), 0),
  }));
  const sources = scriptSources(video.script);
  const seek = (ms: number) => {
    if (!player.current) return;
    player.current.currentTime = ms / 1000;
    void player.current.play().catch(() => {});
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {media.playUrl ? (
          <video ref={player} controls preload="metadata" poster={media.posterUrl ?? undefined} src={media.playUrl} className="aspect-video w-full rounded-xl bg-black" />
        ) : (
          <p className="text-panel text-muted-foreground">The video file is missing.</p>
        )}
        {media.downloadUrl ? <div><Button asChild variant="outline" size="sm"><a href={media.downloadUrl} download>Download</a></Button></div> : null}
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Chapters</h2>
        <ol className="flex flex-col">
          {chapters.map((chapter) => (
            <li key={chapter.id}>
              <button type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-panel hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring outline-none" onClick={() => seek(chapter.start)}>
                <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{formatDuration(chapter.start)}</span>
                <span className="min-w-0 truncate">{chapter.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Sources</h2>
        {sources.length ? (
          <ul className="flex flex-col gap-1 text-panel">
            {sources.map((source) => (
              <li key={source.unitId}><Link href={`/units/${source.unitId}`} className="text-link hover:underline">{source.title || "Untitled claim"}</Link></li>
            ))}
          </ul>
        ) : <p className="text-panel text-muted-foreground">No sources.</p>}
      </section>
    </div>
  );
}
