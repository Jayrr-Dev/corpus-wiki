import type { VideoFiles, VideoStore } from "./pipeline";
import type { RenderJobClient, RenderJobSpec, RenderJobStatus } from "./render";
import type { Scene, VideoPatch, VideoRow, VideoStatus } from "./types";
import type { Alignment, SpeechRequest, VoiceClient } from "./voice";

// =====================================================================
// FAKES for the video tests: an in-memory videos table with the same
// compare-and-set as update_video, Storage, ElevenLabs and Nebius. None
// of them touches the network.
// =====================================================================

export const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
export const SPACE_ID = "22222222-2222-4222-8222-222222222222";

export function scene(id: string, narration = `Narration for ${id}.`, extra: Partial<Scene> = {}): Scene {
  return { id, narration, title: `Title ${id}`, bullets: ["One", "Two"], visual: "list", assetId: null, sources: [{ unitId: `unit-${id}`, revisionId: `rev-${id}`, title: `Claim ${id}` }], ...extra };
}

export function videoRow(extra: Partial<VideoRow> = {}): VideoRow {
  return {
    id: VIDEO_ID, title: "Test video", scopeKind: "topic", scopeId: "33333333-3333-4333-8333-333333333333", coverage: 100, claimIds: null, length: "short",
    voiceId: "voice-1", status: "script", script: { scenes: [scene("a"), scene("b"), scene("c")] }, durationMs: null, videoPath: null,
    posterPath: null, renderJobId: null, error: null, createdBy: null, createdAt: "2026-10-29T10:00:00.000Z", statusChangedAt: "2026-10-29T10:00:00.000Z", ...extra,
  };
}

export class MemoryStore implements VideoStore {
  rows = new Map<string, VideoRow>();
  updates: { id: string; from: VideoStatus[]; patch: VideoPatch }[] = [];
  constructor(rows: VideoRow[] = [], private clock: () => number = () => Date.parse("2026-10-29T10:05:00.000Z")) {
    for (const row of rows) this.rows.set(row.id, structuredClone(row));
  }
  async get(id: string) {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }
  async update(id: string, from: readonly VideoStatus[], patch: VideoPatch) {
    this.updates.push({ id, from: [...from], patch: structuredClone(patch) });
    const row = this.rows.get(id);
    if (!row || !from.includes(row.status)) return null;
    const statusChanged = patch.status !== undefined && patch.status !== row.status;
    const next: VideoRow = { ...row, ...structuredClone(patch), statusChangedAt: statusChanged ? new Date(this.clock()).toISOString() : row.statusChangedAt };
    this.rows.set(id, next);
    return structuredClone(next);
  }
}

export class MemoryFiles implements VideoFiles {
  saved = new Map<string, { bytes: Uint8Array | string; contentType: string }>();
  async upload(path: string, bytes: Uint8Array | string, contentType: string) {
    this.saved.set(path, { bytes, contentType });
  }
  async signedDownloadUrl(path: string, seconds: number) {
    return `https://storage.test/sign/${path}?expires=${seconds}`;
  }
  async signedUploadUrl(path: string) {
    return `https://storage.test/upload/${path}?token=t`;
  }
}

// Character timings for a text: each character takes 50 ms
export function alignmentFor(text: string): Alignment {
  const characters = [...text];
  return { characters, character_start_times_seconds: characters.map((_, index) => index * 0.05), character_end_times_seconds: characters.map((_, index) => (index + 1) * 0.05) };
}

export class FakeVoice implements VoiceClient {
  requests: SpeechRequest[] = [];
  failOn: string | null = null;
  async speak(request: SpeechRequest) {
    this.requests.push(request);
    if (this.failOn && request.text.includes(this.failOn)) throw new Error("ElevenLabs could not voice a scene (429).");
    return { audio: new TextEncoder().encode(`mp3:${request.text}`), alignment: alignmentFor(request.text) };
  }
  async voices() {
    return [{ id: "voice-1", name: "Test", previewUrl: null }];
  }
}

export class FakeJobs implements RenderJobClient {
  created: RenderJobSpec[] = [];
  status: RenderJobStatus | Error = { id: "job-1", state: "running", logTail: null };
  failCreate: Error | null = null;
  async createJob(spec: RenderJobSpec) {
    if (this.failCreate) throw this.failCreate;
    this.created.push(spec);
    return { id: "job-1" };
  }
  async getJob() {
    if (this.status instanceof Error) throw this.status;
    return this.status;
  }
}
