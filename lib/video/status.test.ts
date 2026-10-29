import { describe, expect, it } from "vitest";
import { canEditScript, InvalidTransitionError, isOverdue, isWorking, MAX_ERROR_LENGTH, progressOf, RENDER_CALLBACK_GRACE_MS, RENDER_JOB_TIMEOUT_MS, transition, type VideoEvent, VOICING_TIMEOUT_MS } from "./status";
import { scene, videoRow } from "./testing";
import { VIDEO_STATUSES, type VideoStatus } from "./types";

const EVENTS: VideoEvent[] = [
  { type: "make" },
  { type: "voiced", renderJobId: "job-1" },
  { type: "rendered", videoPath: "s/v/video.mp4", posterPath: "s/v/poster.jpg", durationMs: 31_200.4 },
  { type: "fail", error: "boom" },
  { type: "timeout", error: "late" },
  { type: "retry" },
];

// Every allowed move: [from, event] → to
const ALLOWED: Record<string, VideoStatus> = {
  "script:make": "voicing",
  "voicing:voiced": "rendering",
  "rendering:rendered": "ready",
  "voicing:fail": "failed",
  "rendering:fail": "failed",
  "voicing:timeout": "failed",
  "rendering:timeout": "failed",
  "failed:retry": "voicing",
};

describe("video status machine", () => {
  for (const status of VIDEO_STATUSES) {
    for (const event of EVENTS) {
      const to = ALLOWED[`${status}:${event.type}`];
      it(to ? `${status} --${event.type}--> ${to}` : `${status} refuses ${event.type}`, () => {
        if (to) {
          const move = transition(status, event);
          expect(move).toMatchObject({ from: status, to, patch: { status: to } });
        } else {
          expect(() => transition(status, event)).toThrow(InvalidTransitionError);
        }
      });
    }
  }

  it("make clears an old error", () => {
    expect(transition("script", { type: "make" }).patch).toEqual({ status: "voicing", error: null });
  });

  it("voiced keeps the render job id", () => {
    expect(transition("voicing", { type: "voiced", renderJobId: "job-9" }).patch).toEqual({ status: "rendering", renderJobId: "job-9" });
  });

  it("rendered sets the files and a whole-millisecond duration", () => {
    expect(transition("rendering", EVENTS[2]!).patch).toEqual({ status: "ready", videoPath: "s/v/video.mp4", posterPath: "s/v/poster.jpg", durationMs: 31_200, error: null });
  });

  it("fail and timeout keep a short plain error", () => {
    expect(transition("rendering", { type: "fail", error: "  line one\n\n line two " }).patch.error).toBe("line one\nline two");
    expect(transition("voicing", { type: "timeout", error: "" }).patch.error).toBe("Something went wrong.");
    expect(transition("rendering", { type: "timeout", error: "x".repeat(2000) }).patch.error).toHaveLength(MAX_ERROR_LENGTH);
  });

  it("retry clears the error and the old job", () => {
    expect(transition("failed", { type: "retry" }).patch).toEqual({ status: "voicing", error: null, renderJobId: null });
  });

  it("names the refused move", () => {
    expect(() => transition("ready", { type: "make" })).toThrow("A video that is ready cannot make.");
  });

  it("allows script edits only in script", () => {
    expect(VIDEO_STATUSES.filter(canEditScript)).toEqual(["script"]);
    expect(VIDEO_STATUSES.filter(isWorking)).toEqual(["voicing", "rendering"]);
  });
});

describe("timeouts", () => {
  const at = Date.parse("2026-10-29T10:00:00.000Z");
  const since = "2026-10-29T10:00:00.000Z";

  it("voicing is overdue after the voicing timeout", () => {
    expect(isOverdue({ status: "voicing", statusChangedAt: since }, at + VOICING_TIMEOUT_MS)).toBe(false);
    expect(isOverdue({ status: "voicing", statusChangedAt: since }, at + VOICING_TIMEOUT_MS + 1)).toBe(true);
  });

  it("rendering is overdue only after the job timeout plus the callback grace", () => {
    expect(isOverdue({ status: "rendering", statusChangedAt: since }, at + RENDER_JOB_TIMEOUT_MS + 1)).toBe(false);
    expect(isOverdue({ status: "rendering", statusChangedAt: since }, at + RENDER_JOB_TIMEOUT_MS + RENDER_CALLBACK_GRACE_MS + 1)).toBe(true);
  });

  it("script, ready and failed are never overdue", () => {
    for (const status of ["script", "ready", "failed"] as const) expect(isOverdue({ status, statusChangedAt: since }, at + 10 * RENDER_JOB_TIMEOUT_MS)).toBe(false);
  });
});

describe("progress", () => {
  it("voicing fills the first half by scenes voiced", () => {
    const video = videoRow({ status: "voicing", script: { scenes: [scene("a", "x", { audioPath: "p", durationMs: 1000 }), scene("b"), scene("c"), scene("d")] } });
    expect(progressOf(video, 0, 1)).toEqual({ step: "Voicing scene 2 of 4", percent: 13 });
  });

  it("rendering fills the second half by time and never reaches 100", () => {
    const video = videoRow({ status: "rendering", statusChangedAt: "2026-10-29T10:00:00.000Z" });
    const start = Date.parse(video.statusChangedAt);
    expect(progressOf(video, start + 30_000, 60_000)).toEqual({ step: "Rendering", percent: 75 });
    expect(progressOf(video, start + 10 * 60_000, 60_000).percent).toBe(98);
  });
});
