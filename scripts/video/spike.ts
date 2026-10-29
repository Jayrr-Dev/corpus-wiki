// =====================================================================
// VIDEO SPIKES S1 + S2 (docs/knowledge-modules-plan.md, section 3)
//   S1 Voice   ElevenLabs with-timestamps voices 3 scenes
//   S2 Render  one Nebius Serverless AI CPU job renders them into a
//              ~30-second MP4 with audio and uploads it to Storage
// Records voice cost, cold start and render time in docs/video-spike.md.
// This spends real money: it runs only when every credential is set and
// exits 1 at once, naming what is missing, when one is not.
//
//   node --env-file-if-exists=.env.local scripts/video/spike.ts
//
// Needs: ELEVENLABS_API_KEY, NEBIUS_PROJECT_ID, NEBIUS_IAM_TOKEN,
// VIDEO_RENDER_IMAGE (pushed from scripts/video/render), plus
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY for Storage.
// Optional: ELEVENLABS_VOICE_ID, ELEVENLABS_USD_PER_1K_CHARS,
// NEBIUS_RENDER_USD_PER_HOUR.
// =====================================================================

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const SPIKE_CREDENTIALS = [
  ["ELEVENLABS_API_KEY", "ElevenLabs key (S1 voice)"],
  ["NEBIUS_PROJECT_ID", "Nebius project the render job runs in (S2)"],
  ["NEBIUS_IAM_TOKEN", "Nebius IAM token for the `nebius` CLI (S2)"],
  ["VIDEO_RENDER_IMAGE", "render image pushed to Nebius Container Registry (S2)"],
  ["NEXT_PUBLIC_SUPABASE_URL", "Supabase project URL (Storage)"],
  ["SUPABASE_SECRET_KEY", "Supabase secret key (Storage)"],
] as const;

const missing = SPIKE_CREDENTIALS.filter(([name]) => !process.env[name]?.trim());
if (missing.length) {
  console.error([
    "Video spike not run: credentials are missing. Nothing was called and nothing was spent.",
    ...missing.map(([name, what]) => `  - ${name}: ${what}`),
    "Set them (for example in .env.local) and run: node --env-file-if-exists=.env.local scripts/video/spike.ts",
  ].join("\n"));
  process.exit(1);
}

const SCENES = [
  { narration: "This is a short test of the video pipeline. Three scenes, each voiced on its own, rendered on a CPU job.", title: "Video pipeline test", bullets: ["Voice", "Compose", "Render"], visual: "title" },
  { narration: "Each scene's length comes from its audio, and the captions follow the timing of every word.", title: "Timed from the audio", bullets: ["Character timings", "Captions line up", "No guesswork"], visual: "list" },
  { narration: "If you can hear this, the voice, the render and the upload all worked.", title: "It worked", bullets: ["Voice from ElevenLabs", "Render on Nebius"], visual: "quote" },
] as const;

const runner = (command: string, args: string[], env: Record<string, string>) =>
  new Promise<string>((done, fail) => {
    execFile(command, args, { env: { ...process.env, ...env }, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => (error ? fail(new Error((stderr || error.message).trim())) : done(stdout)));
  });

const { createServer } = await import("vite");
const runtime = await createServer({ configFile: false, appType: "custom", logLevel: "error", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": process.cwd(), "server-only": resolve("test/server-only.ts") } } });
try {
  const voice = await runtime.ssrLoadModule("/lib/video/voice.ts") as typeof import("../../lib/video/voice");
  const compose = await runtime.ssrLoadModule("/lib/video/compose.ts") as typeof import("../../lib/video/compose");
  const render = await runtime.ssrLoadModule("/lib/video/render.ts") as typeof import("../../lib/video/render");
  const cost = await runtime.ssrLoadModule("/lib/video/cost.ts") as typeof import("../../lib/video/cost");
  const { createClient } = await import("@supabase/supabase-js");

  const env = process.env as Record<string, string>;
  const storage = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } }).storage.from("videos");
  const runId = `spike/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const put = async (path: string, body: Uint8Array | string, contentType: string) => {
    const { error } = await storage.upload(path, typeof body === "string" ? new Blob([body], { type: contentType }) : body, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload ${path}: ${error.message}`);
  };
  const signed = async (path: string) => {
    const { data, error } = await storage.createSignedUrl(path, 4 * 3600);
    if (error || !data) throw new Error(`Storage link ${path}: ${error?.message}`);
    return data.signedUrl;
  };
  const uploadUrl = async (path: string) => {
    const { data, error } = await storage.createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new Error(`Storage upload link ${path}: ${error?.message}`);
    return data.signedUrl;
  };

  // S1 VOICE
  const voiceId = env.ELEVENLABS_VOICE_ID || voice.DEFAULT_VOICE_ID;
  console.log(`S1: voicing ${SCENES.length} scenes with voice ${voiceId}…`);
  const voiceStart = Date.now();
  const scenes = await voice.voiceScenes({
    scenes: SCENES.map((scene, index) => ({ ...scene, bullets: [...scene.bullets], id: `scene${index + 1}`, sources: [] })),
    voiceId,
    client: voice.elevenLabsClient(env.ELEVENLABS_API_KEY!),
    save: async (scene, audio) => {
      const path = `${runId}/audio/${scene.id}.mp3`;
      await put(path, audio, "audio/mpeg");
      return path;
    },
  });
  const voiceMs = Date.now() - voiceStart;
  const characters = scenes.reduce((sum, scene) => sum + scene.narration.length, 0);
  const durationMs = compose.totalDurationMs(scenes);
  const rates = cost.ratesFromEnv(env);
  const voiceUsd = (characters / 1000) * rates.voiceUsdPer1kChars;
  console.log(`S1: ${characters} characters → ${(durationMs / 1000).toFixed(1)} s of narration in ${(voiceMs / 1000).toFixed(1)} s`);

  // S2 RENDER
  const html = compose.composeVideo(scenes, { title: "Video spike" });
  await put(`${runId}/composition/index.html`, html, "text/html");
  const placed = compose.placeScenes(scenes);
  const manifest = {
    videoId: runId, durationMs, fps: 30, width: 1920, height: 1080,
    files: [{ path: "index.html", url: await signed(`${runId}/composition/index.html`) }, ...(await Promise.all(placed.map(async (item) => ({ path: item.audioFile, url: await signed(item.scene.audioPath!) }))))],
    audio: placed.map((item) => ({ path: item.audioFile, startMs: item.startMs })),
    output: { videoUploadUrl: await uploadUrl(`${runId}/video.mp4`), posterUploadUrl: await uploadUrl(`${runId}/poster.jpg`) },
    callback: null,
  };
  await put(`${runId}/composition/manifest.json`, JSON.stringify(manifest), "application/json");
  const jobs = render.nebiusJobClient({ projectId: env.NEBIUS_PROJECT_ID!, iamToken: env.NEBIUS_IAM_TOKEN, run: runner });
  const submitted = Date.now();
  const job = await jobs.createJob({ name: `video-spike-${Date.now().toString(36)}`, image: env.VIDEO_RENDER_IMAGE!, env: { MANIFEST_URL: await signed(`${runId}/composition/manifest.json`) }, ...render.RENDER_JOB_DEFAULTS });
  console.log(`S2: job ${job.id} started; waiting (up to ${render.RENDER_JOB_DEFAULTS.timeoutMinutes + 5} min)…`);
  let status = await jobs.getJob(job.id);
  let runningAt: number | null = null;
  while (!render.isJobFinished(status.state) && Date.now() - submitted < (render.RENDER_JOB_DEFAULTS.timeoutMinutes + 5) * 60_000) {
    await new Promise((wait) => setTimeout(wait, 15_000));
    status = await jobs.getJob(job.id);
    if (status.state === "running" && runningAt === null) runningAt = Date.now();
    console.log(`S2: ${status.state} after ${Math.round((Date.now() - submitted) / 1000)} s`);
  }
  const jobMs = Date.now() - submitted;
  const listed = await storage.list(runId, { search: "video.mp4" });
  const landed = Boolean(listed.data?.some((file) => file.name === "video.mp4"));
  const renderUsd = (jobMs / 3_600_000) * rates.renderUsdPerHour;

  const report = `# Video spike results

Run ${new Date().toISOString()} by \`scripts/video/spike.ts\`. Files in Storage under \`videos/${runId}\`.

## S1 Voice: ${scenes.length === SCENES.length ? "yes" : "no"}

| | |
| --- | --- |
| Voice | \`${voiceId}\`, model \`${voice.DEFAULT_VOICE_MODEL}\` |
| Characters | ${characters} |
| Narration | ${(durationMs / 1000).toFixed(1)} s |
| Time to voice | ${(voiceMs / 1000).toFixed(1)} s |
| Cost (at $${rates.voiceUsdPer1kChars}/1k chars) | $${voiceUsd.toFixed(4)}, about $${(voiceUsd / (durationMs / 60_000)).toFixed(3)} per minute of narration |

## S2 Render: ${landed && status.state === "succeeded" ? "yes" : "no"}

| | |
| --- | --- |
| Job | \`${job.id}\`, ${render.RENDER_JOB_DEFAULTS.platform} ${render.RENDER_JOB_DEFAULTS.preset}, final state ${status.state} |
| Cold start (submit → running) | ${runningAt ? `${Math.round((runningAt - submitted) / 1000)} s` : "not seen (polled every 15 s)"} |
| Job time | ${Math.round(jobMs / 1000)} s for ${(durationMs / 1000).toFixed(1)} s of video (${(jobMs / durationMs).toFixed(1)}× real time) |
| Cost (at $${rates.renderUsdPerHour}/hour) | $${renderUsd.toFixed(4)} |
| MP4 in Storage | ${landed ? "yes" : "no"} |
${status.logTail ? `\n### Log tail\n\n\`\`\`\n${status.logTail}\n\`\`\`\n` : ""}`;
  await mkdir("docs", { recursive: true });
  await writeFile("docs/video-spike.md", report);
  console.log(`Wrote docs/video-spike.md. MP4 ${landed ? "landed" : "did not land"} in Storage.`);
  process.exitCode = landed && status.state === "succeeded" ? 0 : 1;
} finally {
  await runtime.close();
}
