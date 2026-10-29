import type { Coverage, CoverageChoice, ScopeKind } from "@/lib/knowledge/scopeTypes";

// =====================================================================
// VIDEO TYPES (docs/knowledge-modules-plan.md, section 3): a video, its
// script of scenes and the status it is in. Shared by the server
// (lib/video/*) and the screens (app/(app)/video); no server imports.
// =====================================================================

export const VIDEO_STATUSES = ["script", "voicing", "rendering", "ready", "failed"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = { script: "Script", voicing: "Voicing", rendering: "Rendering", ready: "Ready", failed: "Failed" };

// short ~1 min, medium ~3 min, long ~5 min; longer videos cover more claims, not slower narration
export const VIDEO_LENGTHS = ["short", "medium", "long"] as const;
export type VideoLength = (typeof VIDEO_LENGTHS)[number];

export const LENGTH_PLAN: Record<VideoLength, { label: string; seconds: number; scenes: number; maxClaims: number }> = {
  short: { label: "About 1 min", seconds: 60, scenes: 4, maxClaims: 12 },
  medium: { label: "3 min", seconds: 180, scenes: 8, maxClaims: 30 },
  long: { label: "5 min", seconds: 300, scenes: 12, maxClaims: 50 },
};

// What a scene shows beside its narration (a HyperFrames template in lib/video/templates.ts)
export const SCENE_VISUALS = ["title", "list", "quote", "diagram", "image"] as const;
export type SceneVisual = (typeof SCENE_VISUALS)[number];

export const SCENE_VISUAL_LABELS: Record<SceneVisual, string> = { title: "Title", list: "List", quote: "Quote", diagram: "Diagram", image: "Image" };

// One caption line, timed from ElevenLabs' character timings
export type Caption = { text: string; startMs: number; endMs: number };

// A claim a scene cites, with the revision it was written from (it goes stale when the claim changes)
export type SceneSource = { unitId: string; revisionId: string; title: string | null };

export type Scene = {
  id: string;
  narration: string;
  // on-screen text
  title: string;
  bullets: string[];
  visual: SceneVisual;
  // an image from Assets, for the image visual
  assetId?: string | null;
  // what the scene's generated graphic shows (written by the Narrator, editable); drawn at Make video
  graphic?: string | null;
  // the drawn graphic in the videos bucket; kept on Try again, cleared when `graphic` changes
  graphicPath?: string | null;
  sources: SceneSource[];
  // set by voicing
  audioPath?: string | null;
  durationMs?: number | null;
  captions?: Caption[] | null;
};

export type VideoScript = { scenes: Scene[] };

// One video as get_video / list_videos return it (supabase/migrations/20261120300000_videos.sql)
export type VideoRow = {
  id: string;
  title: string;
  scopeKind: ScopeKind;
  scopeId: string | null;
  // the share of the scope's claims (the stored number); claimIds is set when the picks were checked by hand
  coverage: Coverage;
  claimIds: string[] | null;
  length: VideoLength;
  voiceId: string;
  status: VideoStatus;
  script: VideoScript;
  durationMs: number | null;
  videoPath: string | null;
  posterPath: string | null;
  renderJobId: string | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  statusChangedAt: string;
};

// The patch update_video accepts
export type VideoPatch = Partial<Pick<VideoRow, "title" | "status" | "script" | "durationMs" | "videoPath" | "posterPath" | "renderJobId" | "error" | "voiceId">>;

// The coverage choice a video was made with: its checked claims, or its share
export const videoCoverage = (video: Pick<VideoRow, "coverage" | "claimIds">): CoverageChoice => (video.claimIds ? { custom: video.claimIds } : video.coverage);

// An ElevenLabs voice, for the New video form
export type VoiceOption = { id: string; name: string; previewUrl: string | null };

export const isVideoLength = (value: unknown): value is VideoLength => (VIDEO_LENGTHS as readonly unknown[]).includes(value);

// "1:05" from milliseconds
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
