import { escapeHtml, FRAME, renderSceneTemplate, SCENE_CSS } from "./templates";
import type { Scene } from "./types";

// =====================================================================
// COMPOSE: the voiced scenes become one HyperFrames composition
// (index.html): each scene is a clip on track 0, its audio a clip on
// track 1 and its captions clips on track 2, all timed from the audio.
// A paused GSAP timeline registered on window.__timelines fades each
// scene's parts in; HyperFrames seeks it frame by frame while rendering.
// The render job downloads the files the manifest lists and renders
// index.html (scripts/video/render/render.mjs).
// =====================================================================

export const COMPOSITION_ID = "video";
// pinned so a render never changes under us; the container caches it
export const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";

export type PlacedScene = { scene: Scene; startMs: number; durationMs: number; audioFile: string; imageFile: string | null };

// Start and length of each scene on the timeline; every scene must be voiced first. `images` maps an
// Assets id, or a scene id for its drawn graphic, to the file in the composition.
export function placeScenes(scenes: readonly Scene[], images: Record<string, string> = {}): PlacedScene[] {
  let at = 0;
  return scenes.map((scene, index) => {
    if (!scene.audioPath || !scene.durationMs) throw new Error(`Scene ${index + 1} is not voiced yet.`);
    const placed = { scene, startMs: at, durationMs: scene.durationMs, audioFile: `audio/${scene.id}.mp3`, imageFile: (scene.assetId ? images[scene.assetId] : undefined) ?? images[scene.id] ?? null };
    at += scene.durationMs;
    return placed;
  });
}

export const totalDurationMs = (scenes: readonly Scene[]) => scenes.reduce((sum, scene) => sum + (scene.durationMs ?? 0), 0);

const seconds = (ms: number) => (ms / 1000).toFixed(3);

// The composition's index.html
export function composeVideo(scenes: readonly Scene[], options: { title: string; images?: Record<string, string> }): string {
  const placed = placeScenes(scenes, options.images);
  const total = placed.reduce((sum, item) => sum + item.durationMs, 0);
  const clips = placed.map((item, index) => {
    const at = seconds(item.startMs), length = seconds(item.durationMs);
    const visual = `<div id="scene-${index}" class="clip" data-start="${at}" data-duration="${length}" data-track-index="0">${renderSceneTemplate(item.scene, item.imageFile)}</div>`;
    const audio = `<audio id="audio-${index}" class="clip" src="${escapeHtml(item.audioFile)}" data-start="${at}" data-duration="${length}" data-track-index="1" data-volume="1"></audio>`;
    const captions = (item.scene.captions ?? []).map((caption, line) => {
      const start = item.startMs + caption.startMs;
      const end = Math.min(item.startMs + Math.max(caption.endMs, caption.startMs + 300), item.startMs + item.durationMs);
      return `<div id="caption-${index}-${line}" class="clip caption" data-start="${seconds(start)}" data-duration="${seconds(Math.max(end - start, 100))}" data-track-index="2"><span>${escapeHtml(caption.text)}</span></div>`;
    });
    return [visual, audio, ...captions].join("\n    ");
  });
  const timeline = placed.map((item, index) => `tl.from("#scene-${index} [data-animate]", { opacity: 0, y: 24, duration: 0.5, stagger: 0.35, ease: "power2.out" }, ${seconds(item.startMs + 150)});`).join("\n      ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${FRAME.width}, height=${FRAME.height}" />
  <title>${escapeHtml(options.title)}</title>
  <style>${SCENE_CSS}</style>
  <script src="${GSAP_URL}"></script>
</head>
<body>
  <div id="root" data-composition-id="${COMPOSITION_ID}" data-start="0" data-duration="${seconds(total)}" data-width="${FRAME.width}" data-height="${FRAME.height}" data-fps="${FRAME.fps}">
    ${clips.join("\n    ")}
  </div>
  <script>
    (function () {
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      ${timeline}
      window.__timelines["${COMPOSITION_ID}"] = tl;
    })();
  </script>
</body>
</html>
`;
}

// What the render job reads: every file with a signed download URL, and where its output goes
export type RenderManifest = {
  videoId: string;
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  files: { path: string; url: string }[];
  // each scene's narration and where it starts, for the ffmpeg mux
  audio: { path: string; startMs: number }[];
  output: { videoUploadUrl: string; posterUploadUrl: string };
  callback: { url: string; token: string } | null;
};
