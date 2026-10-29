import { composeVideo, placeScenes, type RenderManifest, totalDurationMs } from "./compose";
import { isJobFinished, type RenderJobClient, RENDER_JOB_DEFAULTS, timeoutMessage } from "./render";
import { isOverdue, RENDER_CALLBACK_GRACE_MS, RENDER_JOB_TIMEOUT_MS, transition, type VideoEvent } from "./status";
import { FRAME } from "./templates";
import { signCallbackToken } from "./token";
import type { VideoPatch, VideoRow, VideoStatus } from "./types";
import { sceneAudioPath, type VoiceClient, voiceScenes } from "./voice";

// =====================================================================
// MAKE VIDEO: voice every scene, compose, start the render job, then wait
// for its callback, the status poll reading the job (pollRender), or the
// timeout check. Every outside service comes in
// through PipelineDeps: the video rows (update_video), Storage, ElevenLabs
// and Nebius. lib/video/server.ts wires the real ones; tests wire fakes.
// =====================================================================

export interface VideoStore {
  get(id: string): Promise<VideoRow | null>;
  // applies the patch only while the video is in one of `from`; null when it moved on
  update(id: string, from: readonly VideoStatus[], patch: VideoPatch): Promise<VideoRow | null>;
}

export interface VideoFiles {
  upload(path: string, bytes: Uint8Array | string, contentType: string): Promise<void>;
  signedDownloadUrl(path: string, expiresInSeconds: number): Promise<string>;
  signedUploadUrl(path: string): Promise<string>;
}

export type PipelineDeps = {
  spaceId: string;
  store: VideoStore;
  files: VideoFiles;
  voice: () => VoiceClient;
  jobs: () => RenderJobClient;
  renderImage: string;
  callbackBaseUrl: string;
  callbackSecret: string;
  // signed URL and file name of an Assets image, for the image visual
  assetFile?: (assetId: string) => Promise<{ url: string; name: string } | null>;
  now?: () => number;
};

const now = (deps: PipelineDeps) => (deps.now ?? Date.now)();

// Applies one status move, compare-and-set; null when the video had already moved on
export async function applyEvent(store: VideoStore, video: Pick<VideoRow, "id" | "status">, event: VideoEvent, extra: VideoPatch = {}): Promise<VideoRow | null> {
  const move = transition(video.status, event);
  return store.update(video.id, [move.from], { ...extra, ...move.patch });
}

export const videoBase = (spaceId: string, videoId: string) => `${spaceId}/${videoId}`;
export const videoFilePath = (spaceId: string, videoId: string) => `${videoBase(spaceId, videoId)}/video.mp4`;
export const posterFilePath = (spaceId: string, videoId: string) => `${videoBase(spaceId, videoId)}/poster.jpg`;

// Signed download links in the manifest outlive the job
const LINK_SECONDS = Math.ceil((RENDER_JOB_TIMEOUT_MS + RENDER_CALLBACK_GRACE_MS) / 1000) + 3600;

// MAKE VIDEO (script → voicing) or TRY AGAIN (failed → voicing). Returns the video in voicing;
// the caller then runs runPipeline in the background.
export async function startVideo(deps: PipelineDeps, id: string, event: "make" | "retry"): Promise<VideoRow> {
  const video = await deps.store.get(id);
  if (!video) throw new Error("This video no longer exists.");
  const moved = await applyEvent(deps.store, video, { type: event });
  if (!moved) throw new Error("This video changed while you were on the page. Reload and try again.");
  return moved;
}

// VOICE, COMPOSE, START THE RENDER. Runs while the video is in voicing; any error moves it to failed.
export async function runPipeline(deps: PipelineDeps, id: string): Promise<VideoRow | null> {
  let video = await deps.store.get(id);
  if (!video || video.status !== "voicing") return video;
  try {
    const voice = deps.voice();
    const scenes = await voiceScenes({
      scenes: video.script.scenes,
      voiceId: video.voiceId,
      client: voice,
      save: async (scene, audio) => {
        const path = sceneAudioPath(deps.spaceId, id, scene.id);
        await deps.files.upload(path, audio, "audio/mpeg");
        return path;
      },
      onScene: async (voiced) => {
        // keep each voiced scene, so Try again does not pay for it twice; stop if the video moved on
        const saved = await deps.store.update(id, ["voicing"], { script: { scenes: voiced } });
        if (!saved) throw new MovedOnError();
        video = saved;
      },
    });
    const voiced = await deps.store.update(id, ["voicing"], { script: { scenes }, durationMs: totalDurationMs(scenes) });
    if (!voiced) throw new MovedOnError();
    video = voiced;

    const base = videoBase(deps.spaceId, id);
    const images: Record<string, string> = {};
    const files: RenderManifest["files"] = [];
    for (const scene of scenes) {
      files.push({ path: `audio/${scene.id}.mp3`, url: await deps.files.signedDownloadUrl(scene.audioPath!, LINK_SECONDS) });
      if (scene.visual === "image" && scene.assetId && deps.assetFile && !images[scene.assetId]) {
        const asset = await deps.assetFile(scene.assetId);
        if (asset) {
          images[scene.assetId] = `images/${asset.name}`;
          files.push({ path: `images/${asset.name}`, url: asset.url });
        }
      }
    }
    const html = composeVideo(scenes, { title: video.title, images });
    await deps.files.upload(`${base}/composition/index.html`, html, "text/html");
    files.unshift({ path: "index.html", url: await deps.files.signedDownloadUrl(`${base}/composition/index.html`, LINK_SECONDS) });

    // The callback is optional: without a public app URL the status poll reads the job from Nebius (pollRender)
    const callback = deps.callbackBaseUrl && deps.callbackSecret
      ? { url: `${deps.callbackBaseUrl.replace(/\/+$/, "")}/api/video/${id}/rendered`, token: signCallbackToken({ videoId: id, spaceId: deps.spaceId, exp: now(deps) + LINK_SECONDS * 1000 }, deps.callbackSecret) }
      : null;
    const manifest: RenderManifest = {
      videoId: id,
      durationMs: totalDurationMs(scenes),
      fps: FRAME.fps,
      width: FRAME.width,
      height: FRAME.height,
      files,
      audio: placeScenes(scenes).map((item) => ({ path: item.audioFile, startMs: item.startMs })),
      output: { videoUploadUrl: await deps.files.signedUploadUrl(videoFilePath(deps.spaceId, id)), posterUploadUrl: await deps.files.signedUploadUrl(posterFilePath(deps.spaceId, id)) },
      callback,
    };
    await deps.files.upload(`${base}/composition/manifest.json`, JSON.stringify(manifest), "application/json");
    const manifestUrl = await deps.files.signedDownloadUrl(`${base}/composition/manifest.json`, LINK_SECONDS);

    const job = await deps.jobs().createJob({ name: `video-${id.slice(0, 8)}-${now(deps).toString(36)}`, image: deps.renderImage, env: { MANIFEST_URL: manifestUrl }, ...RENDER_JOB_DEFAULTS });
    return (await applyEvent(deps.store, video, { type: "voiced", renderJobId: job.id })) ?? (await deps.store.get(id));
  } catch (error) {
    if (error instanceof MovedOnError) return deps.store.get(id);
    const current = await deps.store.get(id);
    if (!current || (current.status !== "voicing" && current.status !== "rendering")) return current;
    return (await applyEvent(deps.store, current, { type: "fail", error: error instanceof Error ? error.message : String(error) })) ?? (await deps.store.get(id));
  }
}

class MovedOnError extends Error {}

// What the render job posts to the callback
export type RenderedBody =
  | { ok: true; durationMs?: number | null }
  | { ok: false; error?: string | null; logTail?: string | null };

// CALLBACK (rendering → ready or failed). The MP4 and poster went to the paths the manifest named.
// "ignored" when the video is no longer rendering (a late callback after a timeout).
export async function finishRender(deps: Pick<PipelineDeps, "spaceId" | "store">, id: string, body: RenderedBody): Promise<{ result: "ready" | "failed" | "ignored"; video: VideoRow | null }> {
  const video = await deps.store.get(id);
  if (!video || video.status !== "rendering") return { result: "ignored", video };
  if (body.ok) {
    const durationMs = typeof body.durationMs === "number" && body.durationMs > 0 ? body.durationMs : (video.durationMs ?? totalDurationMs(video.script.scenes));
    const ready = await applyEvent(deps.store, video, { type: "rendered", videoPath: videoFilePath(deps.spaceId, id), posterPath: posterFilePath(deps.spaceId, id), durationMs });
    return { result: ready ? "ready" : "ignored", video: ready };
  }
  const error = [body.error?.trim() || "The render failed.", body.logTail?.trim()].filter(Boolean).join("\n");
  const failed = await applyEvent(deps.store, video, { type: "fail", error });
  return { result: failed ? "failed" : "ignored", video: failed };
}

// RENDER POLL (rendering → ready or failed) without a callback: the job's own state says how it ended.
// render.mjs exits 0 only after both uploads, so a succeeded job means the MP4 and poster are in place.
// A job Nebius cannot be asked about right now leaves the video rendering for the next poll.
export async function pollRender(deps: Pick<PipelineDeps, "spaceId" | "store" | "jobs">, video: VideoRow): Promise<VideoRow> {
  if (video.status !== "rendering" || !video.renderJobId) return video;
  const job = await deps.jobs().getJob(video.renderJobId).catch(() => null);
  if (!job || !isJobFinished(job.state)) return video;
  const body: RenderedBody = job.state === "succeeded" ? { ok: true } : { ok: false, error: job.state === "cancelled" ? "The render was stopped before it finished." : "The render failed.", logTail: job.logTail };
  return (await finishRender(deps, video.id, body)).video ?? (await deps.store.get(video.id)) ?? video;
}

// TIMEOUT CHECK: a video stuck in voicing, or rendering with no callback past the job timeout, becomes
// failed; for a render the job's status and log tail come from Nebius. Returns the video as it now stands.
export async function checkOverdue(deps: Pick<PipelineDeps, "store" | "jobs" | "now">, video: VideoRow): Promise<VideoRow> {
  const at = (deps.now ?? Date.now)();
  if (!isOverdue(video, at)) return video;
  let message = "Voicing stopped before it finished.";
  if (video.status === "rendering") {
    const job = video.renderJobId ? await deps.jobs().getJob(video.renderJobId).catch(() => null) : null;
    message = timeoutMessage(job);
  }
  return (await applyEvent(deps.store, video, { type: "timeout", error: message })) ?? (await deps.store.get(video.id)) ?? video;
}
