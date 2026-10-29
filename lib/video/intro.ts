import type { Scope } from "@/lib/knowledge/scopeTypes";
import type { VideoRow } from "./types";

// =====================================================================
// SOURCE VIDEO: the video a study set opens with. The newest ready video
// made from the same source wins; without one, the newest video still
// being made (so the set can say it is on its way). Failed videos and
// unmade scripts never count.
// =====================================================================

const sameSource = (video: VideoRow, scope: Scope) => video.scopeKind === scope.kind && (video.scopeId ?? null) === (scope.id ?? null);

// `videos` newest first, as list_videos returns them
export function sourceVideo(videos: readonly VideoRow[], scope: Scope): VideoRow | null {
  const mine = videos.filter((video) => sameSource(video, scope));
  return mine.find((video) => video.status === "ready") ?? mine.find((video) => video.status === "voicing" || video.status === "rendering") ?? null;
}
