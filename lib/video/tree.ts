import type { Tables } from "@/lib/database/types";
import { buildDomainTree, type DomainNode } from "@/lib/domains/tree";
import type { VideoRow } from "./types";

// =====================================================================
// VIDEO TREE: the Video list (/video) laid out on the domain tree, like
// the Docs list. Topic videos hang on their domain; only branches that
// hold a video are kept. Videos from other sources, or on a retired
// topic, come back apart as `other`.
// =====================================================================

// One topic with its videos and every kept topic under it; `count` is the videos in the whole branch
export type VideoTreeNode = { id: string; name: string; videos: VideoRow[]; children: VideoTreeNode[]; count: number };

function prune(node: DomainNode, byDomain: ReadonlyMap<string, VideoRow[]>): VideoTreeNode | null {
  const children = node.children.map((child) => prune(child, byDomain)).filter((child): child is VideoTreeNode => child !== null);
  const videos = byDomain.get(node.id) ?? [];
  if (!videos.length && !children.length) return null;
  return { id: node.id, name: node.name, videos, children, count: children.reduce((sum, child) => sum + child.count, videos.length) };
}

export function videoTree(domains: readonly Tables<"domains">[], videos: readonly VideoRow[]): { roots: VideoTreeNode[]; other: VideoRow[] } {
  const live = domains.filter((domain) => !domain.retired_at);
  const ids = new Set(live.map((domain) => domain.id));
  const byDomain = new Map<string, VideoRow[]>();
  const other: VideoRow[] = [];
  for (const video of videos) {
    if (video.scopeKind === "topic" && video.scopeId && ids.has(video.scopeId)) byDomain.set(video.scopeId, [...(byDomain.get(video.scopeId) ?? []), video]);
    else other.push(video);
  }
  const roots = buildDomainTree(live).map((root) => prune(root, byDomain)).filter((root): root is VideoTreeNode => root !== null);
  return { roots, other };
}
