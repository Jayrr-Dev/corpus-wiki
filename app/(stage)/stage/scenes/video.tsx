"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import type { QueryClient } from "@tanstack/react-query";
import { ScriptEditor } from "@/app/(app)/video/[id]/ScriptEditor";
import { VideoProgress } from "@/app/(app)/video/[id]/VideoProgress";
import { VideoReady } from "@/app/(app)/video/[id]/VideoReady";
import { StatusChip } from "@/app/(app)/video/StatusChip";
import { Camera, Cursor, Highlight, hoverAmount, pressDepth, seg, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import { DEFAULT_RATES } from "@/lib/video/cost";
import type { VideoRow } from "@/lib/video/types";
import { PHOENIX_VIDEO_FILE, PHOENIX_VIDEO_POSTER, PHOENIX_VIDEO_SCENE_COUNT, PHOENIX_VIDEO_TITLE, phoenixVideo } from "@/lib/video-stage/phoenix/video";

// VIDEO: "And when it makes a video… every render runs as a serverless job on Nebius cloud."
// The script editor's Make video is clicked, the progress moves through voicing and rendering
// (rendering runs on Nebius Serverless AI), then the player and chapters appear. 5.6 seconds.

const CLICK = 0.8;
const PROGRESS = 0.9;
const RENDERING = 2.1;
const READY = 4.4;
// Frame pixels, measured on the stage at 1920x1080
const MAKE_VIDEO = { x: 1349, y: 766 };
const NEBIUS_LINE = { x: 776, y: 191, w: 253, h: 16 };
// The editor scrolls inside this height so its sticky Make video bar stays above the captions
const EDITOR_HEIGHT = 720;

// The status route's reply for each percent, under its own key so the bar is a pure function of t
const statusKey = (status: "voicing" | "rendering", percent: number) => `${phoenixVideo(status).id}-${status}-${percent}`;
const voicingStep = (percent: number) => `Voicing scene ${Math.min(Math.floor(percent / 10) + 1, PHOENIX_VIDEO_SCENE_COUNT)} of ${PHOENIX_VIDEO_SCENE_COUNT}`;

function seed(qc: QueryClient) {
  for (let percent = 0; percent <= 100; percent++) {
    qc.setQueryData(["video-status", statusKey("voicing", percent)], { status: "voicing", error: null, progress: { step: voicingStep(percent), percent } });
    qc.setQueryData(["video-status", statusKey("rendering", percent)], { status: "rendering", error: null, progress: { step: "Rendering", percent } });
  }
}

// Hover and press on the editor's own Make video button, which the scene can't wrap
function makeVideoStyle(t: number): string {
  const depth = pressDepth(t, CLICK);
  const lift = hoverAmount(t, 0.5, PROGRESS);
  return `[data-stage-video-editor] .sticky > div:last-child > button { transform: scale(${1 - 0.05 * depth}); filter: brightness(${(1 + 0.18 * lift) * (1 - 0.15 * depth)}); }`;
}

function Working({ t }: { t: number }) {
  const rendering = t >= RENDERING;
  const percent = rendering ? Math.round(50 + 42 * seg(t, RENDERING, READY - 0.1)) : Math.round(50 * seg(t, PROGRESS + 0.1, RENDERING));
  const video: VideoRow = { ...phoenixVideo(rendering ? "rendering" : "voicing", Math.floor(percent / 10)), id: statusKey(rendering ? "rendering" : "voicing", percent) };
  return (
    <div className="flex flex-col gap-3">
      <VideoProgress video={video} />
      {/* stage-only: the module's step says just "Rendering" */}
      {rendering ? <p className="px-1 text-panel text-muted-foreground" style={{ opacity: seg(t, RENDERING, RENDERING + 0.25) }}>Rendering on Nebius Serverless AI · 1 job</p> : null}
    </div>
  );
}

function VideoScene({ t }: { t: number }) {
  const status = t < PROGRESS ? "script" : t < RENDERING ? "voicing" : t < READY ? "rendering" : "ready";
  return (
    <StageProviders seed={seed}>
      <Camera
        t={t}
        keys={[
          [0, 1, MAKE_VIDEO.x, MAKE_VIDEO.y], [PROGRESS - 0.001, 1.04, MAKE_VIDEO.x, MAKE_VIDEO.y],
          [PROGRESS, 1, NEBIUS_LINE.x, NEBIUS_LINE.y], [READY - 0.1, 1.16, NEBIUS_LINE.x, NEBIUS_LINE.y],
          [READY, 1, 1087, 250], [5.6, 1.05, 1087, 250],
        ]}
      >
        <StageShell title={PHOENIX_VIDEO_TITLE} width="prose" actions={<StatusChip status={status} />}>
          {status === "script" ? (
            <div data-stage-video-editor="" className="overflow-hidden" style={{ maxHeight: EDITOR_HEIGHT }}>
              <style>{makeVideoStyle(t)}</style>
              <ScriptEditor video={phoenixVideo("script")} rates={DEFAULT_RATES} assets={[]} />
            </div>
          ) : (
            // the player is laid out (transparent, under the progress) from the click on, so Chrome's
            // loading spinner has cleared before it shows
            <div className="grid">
              <div style={{ gridArea: "1 / 1", opacity: status === "ready" ? 1 : 0 }}>
                <VideoReady video={phoenixVideo("ready")} media={{ playUrl: PHOENIX_VIDEO_FILE, posterUrl: PHOENIX_VIDEO_POSTER, downloadUrl: "#download" }} />
              </div>
              {status === "ready" ? null : <div style={{ gridArea: "1 / 1" }}><Working t={t} /></div>}
            </div>
          )}
        </StageShell>
        <Highlight t={t} from={2.4} to={4.2} {...NEBIUS_LINE} />
        <Cursor t={t} path={[[0, 1180, 560], [0.5, MAKE_VIDEO.x, MAKE_VIDEO.y], [1.3, MAKE_VIDEO.x, MAKE_VIDEO.y], [2.2, 1240, 620], [READY, 1240, 620], [5.4, 1180, 560]]} clicks={[CLICK]} />
      </Camera>
    </StageProviders>
  );
}

export const video: Scene = { duration: 5.6, Component: VideoScene, title: "Video" };
