// =====================================================================
// RENDER JOB ENTRY (runs inside the render image on Nebius Serverless AI)
// 1. read the manifest at MANIFEST_URL (lib/video/compose.ts RenderManifest)
// 2. download the composition (index.html, scene audio, images)
// 3. render index.html with HyperFrames (headless Chromium) to a silent MP4
// 4. mux the narration with ffmpeg, each scene's audio at its start time
// 5. grab a poster frame, upload the MP4 and poster to their signed URLs
// 6. call back POST /api/video/<id>/rendered with the signed token
// Any failure calls back { ok: false, error, logTail } and exits 1.
// Plain Node 22, no dependencies beyond the image (hyperframes, ffmpeg).
// =====================================================================

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

const WORK = process.env.RENDER_WORKDIR || "/work";
const PROJECT = join(WORK, "project");
const OUT = join(WORK, "out");
const log = [];
const note = (line) => {
  const text = `[${new Date().toISOString()}] ${line}`;
  log.push(text);
  if (log.length > 400) log.shift();
  console.log(text);
};
const tail = (lines = 40) => log.slice(-lines).join("\n");

// Runs a command, keeping its output in the log tail
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    note(`$ ${command} ${args.join(" ")}`);
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const keep = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => note(line));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${file}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

async function upload(url, file, contentType) {
  const response = await fetch(url, { method: "PUT", headers: { "content-type": contentType, "x-upsert": "true" }, body: await readFile(file) });
  if (!response.ok) throw new Error(`Upload failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}

async function callBack(manifest, body) {
  if (!manifest?.callback?.url) return;
  const response = await fetch(manifest.callback.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${manifest.callback.token}` },
    body: JSON.stringify(body),
  });
  note(`callback answered ${response.status}`);
}

// Inside the project folder only: a manifest path can never write elsewhere
function projectPath(path) {
  const full = normalize(join(PROJECT, path));
  if (!full.startsWith(normalize(PROJECT))) throw new Error(`Refusing path outside the project: ${path}`);
  return full;
}

// ffmpeg: every scene's narration delayed to its start, mixed into one track, laid under the video
function muxArgs(manifest, silent, output) {
  const inputs = manifest.audio.flatMap((item) => ["-i", projectPath(item.path)]);
  const delays = manifest.audio.map((item, index) => `[${index + 1}:a]adelay=${Math.round(item.startMs)}:all=1[a${index}]`);
  const mix = `${manifest.audio.map((_, index) => `[a${index}]`).join("")}amix=inputs=${manifest.audio.length}:normalize=0:dropout_transition=0[narration]`;
  return ["-y", "-i", silent, ...inputs, "-filter_complex", [...delays, mix].join(";"), "-map", "0:v", "-map", "[narration]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", output];
}

async function main() {
  const started = Date.now();
  const manifestUrl = process.env.MANIFEST_URL;
  if (!manifestUrl) throw new Error("MANIFEST_URL is not set.");
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Could not read the manifest (${response.status}).`);
  const manifest = await response.json();
  try {
    note(`video ${manifest.videoId}: ${manifest.files.length} files, ${Math.round(manifest.durationMs / 1000)} s`);
    await mkdir(OUT, { recursive: true });
    for (const file of manifest.files) await download(file.url, projectPath(file.path));
    const downloaded = Date.now();

    const silent = join(OUT, "silent.mp4");
    const video = join(OUT, "video.mp4");
    const poster = join(OUT, "poster.jpg");
    await run("hyperframes", ["render", "--output", silent, "--fps", String(manifest.fps), "--quality", "standard"], PROJECT);
    const rendered = Date.now();
    await run("ffmpeg", muxArgs(manifest, silent, video), PROJECT);
    await run("ffmpeg", ["-y", "-ss", "1", "-i", video, "-frames:v", "1", "-q:v", "3", poster], PROJECT);

    await upload(manifest.output.videoUploadUrl, video, "video/mp4");
    await upload(manifest.output.posterUploadUrl, poster, "image/jpeg");
    note(`timings: download ${downloaded - started} ms, render ${rendered - downloaded} ms, total ${Date.now() - started} ms`);
    await callBack(manifest, { ok: true, durationMs: manifest.durationMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    note(`failed: ${message}`);
    await callBack(manifest, { ok: false, error: message, logTail: tail() }).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
