import type { VideoPatch, VideoRow, VideoStatus } from "./types";

// =====================================================================
// VIDEO STATUS MACHINE: the only moves a video can make.
//   script    --make-->      voicing     (you continue after checking the script)
//   voicing   --voiced-->    rendering   (every scene has audio; the render job started)
//   rendering --rendered-->  ready       (the job called back with the MP4)
//   voicing   --fail-->      failed      (ElevenLabs or the job start failed)
//   rendering --fail-->      failed      (the job called back with an error)
//   voicing   --timeout-->   failed      (voicing stopped without finishing)
//   rendering --timeout-->   failed      (no callback before the job timeout)
//   failed    --retry-->     voicing     (Try again; scenes already voiced are kept)
// The script can be edited or rewritten only in `script`, before anything costs money.
// The database applies each move only while the row is still in `from`
// (update_video), so a late callback can never undo a timeout.
// =====================================================================

export type VideoEvent =
  | { type: "make" }
  | { type: "voiced"; renderJobId: string }
  | { type: "rendered"; videoPath: string; posterPath: string | null; durationMs: number }
  | { type: "fail"; error: string }
  | { type: "timeout"; error: string }
  | { type: "retry" };

export type Transition = { from: VideoStatus; to: VideoStatus; patch: VideoPatch };

export class InvalidTransitionError extends Error {
  constructor(readonly status: VideoStatus, readonly event: VideoEvent["type"]) {
    super(`A video that is ${status} cannot ${event}.`);
  }
}

// Error text shown on the Failed screen stays short and plain; line breaks (a log tail) stay
export const MAX_ERROR_LENGTH = 600;
export const plainError = (error: string) => {
  const text = error.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n") || "Something went wrong.";
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
};

// The move an event makes from a status, with the fields it sets; throws when the move is not allowed
export function transition(status: VideoStatus, event: VideoEvent): Transition {
  const move = (to: VideoStatus, patch: VideoPatch = {}): Transition => ({ from: status, to, patch: { ...patch, status: to } });
  switch (event.type) {
    case "make":
      if (status === "script") return move("voicing", { error: null });
      break;
    case "voiced":
      if (status === "voicing") return move("rendering", { renderJobId: event.renderJobId });
      break;
    case "rendered":
      if (status === "rendering") return move("ready", { videoPath: event.videoPath, posterPath: event.posterPath, durationMs: Math.round(event.durationMs), error: null });
      break;
    case "fail":
    case "timeout":
      if (status === "voicing" || status === "rendering") return move("failed", { error: plainError(event.error) });
      break;
    case "retry":
      if (status === "failed") return move("voicing", { error: null, renderJobId: null });
      break;
  }
  throw new InvalidTransitionError(status, event.type);
}

export const canEditScript = (status: VideoStatus) => status === "script";
export const isWorking = (status: VideoStatus) => status === "voicing" || status === "rendering";

// TIMEOUTS: voicing runs in the app and should finish in minutes; rendering waits for the
// job's timeout plus a grace period for the upload and callback
export const VOICING_TIMEOUT_MS = 15 * 60_000;
// Nebius rejects job timeouts under 1 hour
export const RENDER_JOB_TIMEOUT_MS = 60 * 60_000;
export const RENDER_CALLBACK_GRACE_MS = 5 * 60_000;

// True when a working video has waited past its deadline
export function isOverdue(video: Pick<VideoRow, "status" | "statusChangedAt">, now: number): boolean {
  const since = Date.parse(video.statusChangedAt);
  if (!Number.isFinite(since)) return false;
  if (video.status === "voicing") return now - since > VOICING_TIMEOUT_MS;
  if (video.status === "rendering") return now - since > RENDER_JOB_TIMEOUT_MS + RENDER_CALLBACK_GRACE_MS;
  return false;
}

// PROGRESS for the Voicing / Rendering screen: voicing fills the first half by scenes voiced,
// rendering the second half by time against an expected render time
export function progressOf(video: Pick<VideoRow, "status" | "statusChangedAt" | "script" | "durationMs">, now: number, expectedRenderMs: number): { step: string; percent: number } {
  if (video.status === "voicing") {
    const scenes = video.script.scenes;
    const voiced = scenes.filter((scene) => scene.audioPath).length;
    return { step: `Voicing scene ${Math.min(voiced + 1, Math.max(scenes.length, 1))} of ${Math.max(scenes.length, 1)}`, percent: scenes.length ? Math.round((voiced / scenes.length) * 50) : 0 };
  }
  if (video.status === "rendering") {
    const elapsed = Math.max(0, now - Date.parse(video.statusChangedAt));
    const share = expectedRenderMs > 0 ? Math.min(elapsed / expectedRenderMs, 0.95) : 0;
    return { step: "Rendering", percent: Math.round(50 + share * 50) };
  }
  return { step: "", percent: video.status === "ready" ? 100 : 0 };
}
