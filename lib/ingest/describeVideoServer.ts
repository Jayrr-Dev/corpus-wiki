import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import { describeImageAnswerJsonSchema, describeImageAnswerSchema, resolveVisionModel } from "./describeMedia";
import {
  buildDescribeVideoMessages,
  describeVideoAnswerToText,
  frameTimes,
  resolveTranscribeModel,
  type TranscriptSegment,
  type VideoFrame,
  type VideoReader,
} from "./describeVideo";

// =====================================================================
// THE VIDEO READER the app uses: ffmpeg (the ffmpeg-static binary, or
// FFMPEG_PATH) takes the sound and a few frames, Whisper writes the
// transcript in this process, and the vision model on Token Factory
// describes the frames with the transcript beside them. Null without a
// key (a video cannot be described then, and the Upload screen says so).
// =====================================================================

export function videoReaderFrom(settings: TokenFactorySettings | null, env: NodeJS.ProcessEnv = process.env): VideoReader | null {
  if (!settings) return null;
  const vision = { ...settings, model: resolveVisionModel(env) };
  return async (video) => {
    // ffmpeg seeks in a file (an mp4 often keeps its index at the end), so the bytes go to a temp file
    const path = join(tmpdir(), `second-brain-${randomUUID()}`);
    await writeFile(path, video.bytes);
    try {
      const probe = await probeVideo(path);
      const [transcript, frames] = await Promise.all([
        probe.hasAudio ? transcribe(await readAudio(path), env) : Promise.resolve([]),
        Promise.all(frameTimes(probe.durationSeconds).map((time) => readFrame(path, time))),
      ]);
      const pictures = frames.filter((frame): frame is VideoFrame => frame !== null);
      if (pictures.length === 0 && transcript.length === 0) throw new Error("No picture or speech could be read from this video.");
      const answer = await chatJson(vision, {
        name: "describe_video",
        subject: video.fileName,
        schema: describeImageAnswerSchema,
        jsonSchema: describeImageAnswerJsonSchema,
        messages: buildDescribeVideoMessages(video.fileName, pictures, transcript),
        maxTokens: 4_000,
      });
      return { description: describeVideoAnswerToText(answer.value), transcript };
    } finally {
      await rm(path, { force: true });
    }
  };
}

// FFMPEG: FFMPEG_PATH, else the binary ffmpeg-static ships, else the one on PATH
async function ffmpegPath(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const { default: bundled } = await import("ffmpeg-static");
  return (bundled as unknown as string | null) ?? "ffmpeg";
}

// Runs ffmpeg and collects its output; stdout holds the media, stderr the log
async function runFfmpeg(args: string[]): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  const binary = await ffmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-nostdin", ...args], { windowsHide: true });
    const out: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => reject(new Error(`ffmpeg could not run (${error.message}). Install ffmpeg or set FFMPEG_PATH.`)));
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out), stderr }));
  });
}

// LENGTH AND SOUND: from the log `ffmpeg -i` prints (it exits non-zero, having no output)
async function probeVideo(path: string): Promise<{ durationSeconds: number; hasAudio: boolean }> {
  const { stderr } = await runFfmpeg(["-i", path]);
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!duration && !/Stream #/.test(stderr)) throw new Error("This file could not be read as a video.");
  const durationSeconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0;
  return { durationSeconds, hasAudio: /Stream #.*: Audio:/.test(stderr) };
}

// ONE FRAME as a JPEG at most 768 px wide (null when the video has no picture there)
async function readFrame(path: string, time: number): Promise<VideoFrame | null> {
  const { stdout } = await runFfmpeg(["-loglevel", "error", "-ss", String(time), "-i", path, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"]);
  return stdout.byteLength > 0 ? { time, jpeg: new Uint8Array(stdout) } : null;
}

// THE SOUND as Whisper hears it: mono 16 kHz float samples
async function readAudio(path: string): Promise<Float32Array> {
  const { code, stdout, stderr } = await runFfmpeg(["-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"]);
  if (code !== 0) throw new Error(`The video's sound could not be read: ${stderr.trim() || `ffmpeg exited with ${code}`}`);
  const samples = new Float32Array(stdout.byteLength / 4);
  new Uint8Array(samples.buffer).set(stdout.subarray(0, samples.byteLength));
  return samples;
}

// WHISPER: loaded once per model and kept for the life of the server
type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: { timestamp: [number | null, number | null]; text: string }[] }>;
const loaded = ((globalThis as { __whisper?: Map<string, Promise<Transcriber>> }).__whisper ??= new Map());

async function transcriber(model: string): Promise<Transcriber> {
  let pending = loaded.get(model);
  if (!pending) {
    pending = import("@huggingface/transformers").then(({ pipeline }) => pipeline("automatic-speech-recognition", model, { dtype: "q8" }) as unknown as Promise<Transcriber>);
    pending.catch(() => loaded.delete(model));
    loaded.set(model, pending);
  }
  return pending;
}

// SPEECH -> transcript segments with their start times ([] for a silent video)
async function transcribe(audio: Float32Array, env: NodeJS.ProcessEnv): Promise<TranscriptSegment[]> {
  if (audio.length === 0) return [];
  const asr = await transcriber(resolveTranscribeModel(env));
  const result = await asr(audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: "transcribe", ...(env.AI_TRANSCRIBE_LANGUAGE && { language: env.AI_TRANSCRIBE_LANGUAGE }) });
  const chunks = result.chunks ?? [{ timestamp: [0, null], text: result.text }];
  return chunks.map((chunk) => ({ start: chunk.timestamp[0] ?? 0, text: chunk.text.trim() })).filter((segment) => segment.text);
}
