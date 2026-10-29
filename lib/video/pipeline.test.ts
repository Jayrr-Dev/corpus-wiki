import { describe, expect, it } from "vitest";
import type { RenderManifest } from "./compose";
import { checkOverdue, finishRender, type PipelineDeps, runPipeline, startVideo } from "./pipeline";
import { RENDER_CALLBACK_GRACE_MS, RENDER_JOB_TIMEOUT_MS, VOICING_TIMEOUT_MS } from "./status";
import { FakeJobs, FakeVoice, MemoryFiles, MemoryStore, scene, SPACE_ID, VIDEO_ID, videoRow } from "./testing";
import { verifyCallbackToken } from "./token";
import type { VideoRow } from "./types";

const NOW = Date.parse("2026-10-29T10:05:00.000Z");

function setup(row: Partial<VideoRow> = {}) {
  const store = new MemoryStore([videoRow(row)], () => NOW);
  const files = new MemoryFiles();
  const voice = new FakeVoice();
  const jobs = new FakeJobs();
  const deps: PipelineDeps = {
    spaceId: SPACE_ID, store, files, voice: () => voice, jobs: () => jobs, renderImage: "cr.test/render:1",
    callbackBaseUrl: "https://app.test/", callbackSecret: "secret", now: () => NOW,
  };
  return { store, files, voice, jobs, deps };
}

describe("make video", () => {
  it("script → voicing → rendering: voices every scene, uploads the composition and starts one job", async () => {
    const { store, files, voice, jobs, deps } = setup();
    expect((await startVideo(deps, VIDEO_ID, "make")).status).toBe("voicing");
    const video = await runPipeline(deps, VIDEO_ID);

    expect(video).toMatchObject({ status: "rendering", renderJobId: "job-1" });
    expect(voice.requests).toHaveLength(3);
    expect(video!.script.scenes.every((item) => item.audioPath && item.durationMs && item.captions?.length)).toBe(true);
    expect(video!.durationMs).toBe(video!.script.scenes.reduce((sum, item) => sum + item.durationMs!, 0));
    expect([...files.saved.keys()]).toEqual([
      `${SPACE_ID}/${VIDEO_ID}/audio/a.mp3`, `${SPACE_ID}/${VIDEO_ID}/audio/b.mp3`, `${SPACE_ID}/${VIDEO_ID}/audio/c.mp3`,
      `${SPACE_ID}/${VIDEO_ID}/composition/index.html`, `${SPACE_ID}/${VIDEO_ID}/composition/manifest.json`,
    ]);
    expect(jobs.created).toHaveLength(1);
    expect(jobs.created[0]).toMatchObject({ image: "cr.test/render:1", platform: "cpu-e1", preset: "4vcpu-16gb", diskGiB: 20, timeoutMinutes: 30 });
    expect(jobs.created[0]!.env.MANIFEST_URL).toContain("composition/manifest.json");

    const manifest = JSON.parse(String(files.saved.get(`${SPACE_ID}/${VIDEO_ID}/composition/manifest.json`)!.bytes)) as RenderManifest;
    expect(manifest.files.map((file) => file.path)).toEqual(["index.html", "audio/a.mp3", "audio/b.mp3", "audio/c.mp3"]);
    expect(manifest.audio.map((item) => item.startMs)).toEqual([0, video!.script.scenes[0]!.durationMs, video!.script.scenes[0]!.durationMs! + video!.script.scenes[1]!.durationMs!]);
    expect(manifest.callback!.url).toBe(`https://app.test/api/video/${VIDEO_ID}/rendered`);
    expect(verifyCallbackToken(manifest.callback!.token, "secret", VIDEO_ID, NOW)).toMatchObject({ ok: true, claims: { spaceId: SPACE_ID } });
    // each voiced scene was saved as it landed, then the move to rendering
    expect(store.updates.map((update) => update.patch.status ?? "script")).toEqual(["voicing", "script", "script", "script", "script", "rendering"]);
  });

  it("refuses Make video unless the video is in script", async () => {
    const { deps } = setup({ status: "rendering" });
    await expect(startVideo(deps, VIDEO_ID, "make")).rejects.toThrow("cannot make");
  });

  it("voicing → failed when ElevenLabs fails, keeping the scenes voiced so far", async () => {
    const { voice, jobs, deps } = setup();
    voice.failOn = "Narration for b";
    await startVideo(deps, VIDEO_ID, "make");
    const video = await runPipeline(deps, VIDEO_ID);
    expect(video).toMatchObject({ status: "failed", error: "ElevenLabs could not voice a scene (429)." });
    expect(video!.script.scenes.map((item) => Boolean(item.audioPath))).toEqual([true, false, false]);
    expect(jobs.created).toHaveLength(0);
  });

  it("voicing → failed when the render job cannot start", async () => {
    const { jobs, deps } = setup();
    jobs.failCreate = new Error("quota exceeded for cpu-e1");
    await startVideo(deps, VIDEO_ID, "make");
    expect(await runPipeline(deps, VIDEO_ID)).toMatchObject({ status: "failed", error: "quota exceeded for cpu-e1" });
  });

  it("failed → voicing on Try again, without paying again for voiced scenes", async () => {
    const { voice, deps } = setup({ status: "failed", error: "old", script: { scenes: [scene("a", "Kept.", { audioPath: "x/a.mp3", durationMs: 800, captions: [] }), scene("b")] } });
    expect(await startVideo(deps, VIDEO_ID, "retry")).toMatchObject({ status: "voicing", error: null });
    expect(await runPipeline(deps, VIDEO_ID)).toMatchObject({ status: "rendering" });
    expect(voice.requests.map((request) => request.text)).toEqual(["Narration for b."]);
  });

  it("stops quietly when the video moved on while voicing", async () => {
    const { store, jobs, deps } = setup({ status: "voicing" });
    const voice = new FakeVoice();
    deps.voice = () => ({
      voices: voice.voices,
      speak: async (request) => {
        store.rows.get(VIDEO_ID)!.status = "failed";
        return voice.speak(request);
      },
    });
    expect(await runPipeline(deps, VIDEO_ID)).toMatchObject({ status: "failed" });
    expect(jobs.created).toHaveLength(0);
  });

  it("does nothing for a video that is not voicing", async () => {
    const { voice, deps } = setup({ status: "script" });
    expect(await runPipeline(deps, VIDEO_ID)).toMatchObject({ status: "script" });
    expect(voice.requests).toHaveLength(0);
  });
});

describe("render callback", () => {
  it("rendering → ready with the MP4, poster and duration", async () => {
    const { deps } = setup({ status: "rendering", renderJobId: "job-1" });
    const { result, video } = await finishRender(deps, VIDEO_ID, { ok: true, durationMs: 31_000 });
    expect(result).toBe("ready");
    expect(video).toMatchObject({ status: "ready", videoPath: `${SPACE_ID}/${VIDEO_ID}/video.mp4`, posterPath: `${SPACE_ID}/${VIDEO_ID}/poster.jpg`, durationMs: 31_000, error: null });
  });

  it("rendering → failed with the job's error and log tail", async () => {
    const { deps } = setup({ status: "rendering" });
    const { result, video } = await finishRender(deps, VIDEO_ID, { ok: false, error: "Chromium crashed", logTail: "line 1\nline 2" });
    expect(result).toBe("failed");
    expect(video).toMatchObject({ status: "failed", error: "Chromium crashed\nline 1\nline 2" });
  });

  it("ignores a late callback after the video failed", async () => {
    const { store, deps } = setup({ status: "failed", error: "timed out" });
    expect((await finishRender(deps, VIDEO_ID, { ok: true })).result).toBe("ignored");
    expect(store.rows.get(VIDEO_ID)).toMatchObject({ status: "failed", error: "timed out" });
  });
});

describe("timeout check", () => {
  const changed = new Date(NOW).toISOString();

  it("rendering → failed when no callback came before the job timeout, with the job's log tail", async () => {
    const { jobs, deps } = setup({ status: "rendering", renderJobId: "job-1", statusChangedAt: changed });
    jobs.status = { id: "job-1", state: "failed", logTail: "ffmpeg: no such file" };
    const later = { ...deps, now: () => NOW + RENDER_JOB_TIMEOUT_MS + RENDER_CALLBACK_GRACE_MS + 1 };
    expect(await checkOverdue(later, (await deps.store.get(VIDEO_ID))!)).toMatchObject({ status: "failed", error: "The render failed.\nffmpeg: no such file" });
  });

  it("rendering → failed even when Nebius cannot be reached", async () => {
    const { jobs, deps } = setup({ status: "rendering", renderJobId: "job-1", statusChangedAt: changed });
    jobs.status = new Error("network down");
    const later = { ...deps, now: () => NOW + RENDER_JOB_TIMEOUT_MS + RENDER_CALLBACK_GRACE_MS + 1 };
    expect(await checkOverdue(later, (await deps.store.get(VIDEO_ID))!)).toMatchObject({ status: "failed", error: "The render did not report back in time." });
  });

  it("leaves a render alone before the deadline", async () => {
    const { deps } = setup({ status: "rendering", renderJobId: "job-1", statusChangedAt: changed });
    const soon = { ...deps, now: () => NOW + RENDER_JOB_TIMEOUT_MS };
    expect(await checkOverdue(soon, (await deps.store.get(VIDEO_ID))!)).toMatchObject({ status: "rendering" });
  });

  it("voicing → failed when voicing stopped", async () => {
    const { deps } = setup({ status: "voicing", statusChangedAt: changed });
    const later = { ...deps, now: () => NOW + VOICING_TIMEOUT_MS + 1 };
    expect(await checkOverdue(later, (await deps.store.get(VIDEO_ID))!)).toMatchObject({ status: "failed", error: "Voicing stopped before it finished." });
  });

  it("returns the newer row when the callback won the race", async () => {
    const { store, deps } = setup({ status: "rendering", statusChangedAt: changed });
    const stale = (await store.get(VIDEO_ID))!;
    await finishRender(deps, VIDEO_ID, { ok: true });
    const later = { ...deps, now: () => NOW + RENDER_JOB_TIMEOUT_MS + RENDER_CALLBACK_GRACE_MS + 1 };
    expect(await checkOverdue(later, stale)).toMatchObject({ status: "ready" });
  });
});
