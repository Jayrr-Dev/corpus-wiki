import { describe, expect, it } from "vitest";
import { sourceVideo } from "./intro";
import type { VideoRow, VideoStatus } from "./types";

const video = (id: string, status: VideoStatus, scopeId: string | null = "t1", scopeKind: VideoRow["scopeKind"] = "topic") => ({ id, status, scopeKind, scopeId }) as VideoRow;

describe("sourceVideo", () => {
  it("picks the newest ready video from the same source", () => {
    expect(sourceVideo([video("a", "rendering"), video("b", "ready"), video("c", "ready")], { kind: "topic", id: "t1" })?.id).toBe("b");
  });

  it("falls back to a video still being made, never a failed one or a script", () => {
    expect(sourceVideo([video("a", "failed"), video("b", "script"), video("c", "voicing")], { kind: "topic", id: "t1" })?.id).toBe("c");
    expect(sourceVideo([video("a", "failed"), video("b", "script")], { kind: "topic", id: "t1" })).toBeNull();
  });

  it("ignores other sources", () => {
    expect(sourceVideo([video("a", "ready", "t2"), video("b", "ready", "t1", "article")], { kind: "topic", id: "t1" })).toBeNull();
    expect(sourceVideo([video("g", "ready", null, "glossary")], { kind: "glossary", id: null })?.id).toBe("g");
  });
});
