import type { ChatMediaMessage, ChatMessage } from "@/lib/ai/chat";
import { describeImageAnswerToText, type DescribeImageAnswer } from "./describeMedia";
import type { ExtractedPage } from "./passages";

// =====================================================================
// VIDEO SOURCES: a video is a source like a PDF. Speech-to-text writes
// its transcript and the vision model describes a few sampled frames
// (read together with the transcript). The text is the description,
// summary first (passage 0 is the figure caption), then the transcript,
// each piece located at the time it starts ({ time: "mm:ss" }).
// =====================================================================

// PROMPT VERSION: recorded in the AI call log under the call name
export const DESCRIBE_VIDEO_PROMPT_VERSION = "describe-video-v2";

// FRAMES SENT TO THE VISION MODEL (evenly spread over the video)
export const VIDEO_FRAME_COUNT = 6;

// SPEECH-TO-TEXT MODEL: Token Factory has none, so Whisper runs in the app server
// (transformers.js, downloaded once and cached). AI_TRANSCRIBE_MODEL picks another
// onnx-community Whisper; AI_TRANSCRIBE_LANGUAGE names the spoken language (default English).
export const DEFAULT_TRANSCRIBE_MODEL = "onnx-community/whisper-base";
export function resolveTranscribeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.AI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
}

// A TRANSCRIPT PIECE: what was said, from `start` seconds
export type TranscriptSegment = { start: number; text: string };

// WHAT A CONVERTER NEEDS TO HAVE A VIDEO READ (the server wires ffmpeg, Whisper and the model in)
export type VideoToRead = { bytes: Uint8Array; mimeType: string; fileName: string };
export type VideoReading = { description: string; transcript: TranscriptSegment[] };
export type VideoReader = (video: VideoToRead) => Promise<VideoReading>;

// WHAT A CONVERTER NEEDS TO HAVE A RECORDING READ: the same speech-to-text step, no frames
export type AudioToRead = VideoToRead;
export type AudioReading = { transcript: TranscriptSegment[] };
export type AudioReader = (audio: AudioToRead) => Promise<AudioReading>;

// One sampled frame, as JPEG, and when it was taken
export type VideoFrame = { time: number; jpeg: Uint8Array };

// SECONDS -> "mm:ss" (minutes keep counting past an hour: "75:03")
export function formatVideoTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

// WHEN TO TAKE THE FRAMES: the middle of `count` equal stretches, so neither the
// black first frame nor the last one is picked
export function frameTimes(durationSeconds: number, count = VIDEO_FRAME_COUNT): number[] {
  if (!(durationSeconds > 0)) return [0];
  return Array.from({ length: count }, (_, index) => Math.round(((index + 0.5) * durationSeconds * 1000) / count) / 1000);
}

// LONGEST TRANSCRIPT PIECE: Whisper's short segments are joined into paragraphs of about this
// many characters (each keeps the time it starts), so one passage carries a whole thought
const TRANSCRIPT_PARAGRAPH_CHARS = 450;

// Whisper's segments -> transcript paragraphs, each starting a fresh one past the size above
export function groupTranscript(segments: readonly TranscriptSegment[]): TranscriptSegment[] {
  const groups: TranscriptSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = groups.at(-1);
    if (last && last.text.length + text.length + 1 <= TRANSCRIPT_PARAGRAPH_CHARS) last.text = `${last.text} ${text}`;
    else groups.push({ start: segment.start, text });
  }
  return groups;
}

// THE TRANSCRIPT'S TEXT: each paragraph at the time it starts ({ time: "mm:ss" })
export function transcriptPages(transcript: readonly TranscriptSegment[]): ExtractedPage[] {
  return groupTranscript(transcript).map((segment) => ({ page: null, text: segment.text, time: formatVideoTime(segment.start) }));
}

// THE VIDEO'S TEXT: the description (no time), then each transcript paragraph at its time
export function videoPages(reading: VideoReading): ExtractedPage[] {
  return [...(reading.description.trim() ? [{ page: null, text: reading.description }] : []), ...transcriptPages(reading.transcript)];
}

// A RECORDING'S TEXT: only its transcript, each paragraph at its time
export function audioPages(reading: AudioReading): ExtractedPage[] {
  return transcriptPages(reading.transcript);
}

const SYSTEM_PROMPT = `You describe one video for a personal knowledge base. You get a few frames sampled from it, each with its time, and the transcript of what is said. Your description and the transcript are the only text the knowledge base will have for this video: facts are extracted from them and cited back to the video.

Answer with JSON only: { "summary": "...", "details": ["...", "..."] }.
- summary: one or two sentences saying what the video is and what it is about, written as a figure caption ("Walkthrough of the new office building, from the lobby to the rooftop terrace."). It may draw on the transcript.
- details: ONLY what the frames show: setting, people's roles when shown in writing, slides, charts, every visible number, label and date, and readable on-screen text transcribed exactly. Short paragraphs, each able to stand alone (name the subject again; no "it" or "this" pointing back).
- details never repeats or reports what is said ("The transcript states...", "The speaker says..."): the transcript is stored as it is and its facts are cited from it already. If the frames show nothing more, details is [].
- Write details as facts about the subject, not about the footage: "The Rotterdam warehouse has six loading docks.", not "The video shows six doors."
- State only what is visible or said. Never guess identities, places or dates that the video does not show in writing or say. No opinions about style or quality.
- Use the file name only as a hint for what the video is about.
- Plain text only: no Markdown, no bullet characters, no headings.`;

// The transcript as the model reads it: one "[mm:ss] text" line per segment, cut to a sane length
const MAX_PROMPT_TRANSCRIPT_CHARS = 20_000;
function transcriptForPrompt(transcript: readonly TranscriptSegment[]): string {
  const text = transcript.map((segment) => `[${formatVideoTime(segment.start)}] ${segment.text.trim()}`).join("\n");
  if (!text) return "(no speech)";
  return text.length > MAX_PROMPT_TRANSCRIPT_CHARS ? `${text.slice(0, MAX_PROMPT_TRANSCRIPT_CHARS)}\n[transcript continues]` : text;
}

// The prompt: the instructions, the file's name and transcript, then each frame after its time
export function buildDescribeVideoMessages(fileName: string, frames: readonly VideoFrame[], transcript: readonly TranscriptSegment[]): (ChatMessage | ChatMediaMessage)[] {
  const frameParts = frames.flatMap((frame) => [
    { type: "text" as const, text: `Frame at ${formatVideoTime(frame.time)}:` },
    { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${Buffer.from(frame.jpeg).toString("base64")}` } },
  ]);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: [{ type: "text", text: `File name: ${fileName}\n\nTranscript:\n${transcriptForPrompt(transcript)}` }, ...frameParts] },
  ];
}

// ANSWER -> the description text (same cleaning as an image's). A detail that reports the
// transcript is dropped: the transcript's own passages already carry those facts.
const REPORTS_SPEECH = /\b(?:transcript|narrat(?:or|ion)|(?:speaker|presenter|narrator|voice-?over)\s+(?:says|said|states|stated|mentions|mentioned|explains|explained|announces|announced))\b/i;
export function describeVideoAnswerToText(answer: DescribeImageAnswer): string {
  return describeImageAnswerToText({ summary: answer.summary, details: answer.details.filter((detail) => !REPORTS_SPEECH.test(detail)) });
}
