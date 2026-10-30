// SPACE THUMBNAILS, the parts with no server or database: which assets can become a
// thumbnail, the rule-based ranking the AI pick falls back on, and the cover drawn
// when a Space has no picture at all. Nothing here can fail or needs a provider.

export type ThumbnailAsset = {
  id: string; kind: string; mime_type: string | null; storage_path: string; deleted_at: string | null;
  title: string | null; description: string | null; tags: string[] | null; asset_type: string | null; created_at: string;
};
export type ThumbnailContext = { title: string; description: string; pageTitles: string[] };

const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Only pictures whose bytes sit in Storage: generated SVGs and stakeholder logos live elsewhere
export function canBeThumbnail(asset: Pick<ThumbnailAsset, "kind" | "mime_type" | "storage_path" | "deleted_at">): boolean {
  return asset.kind === "image" && asset.deleted_at === null && RASTER.has(asset.mime_type ?? "")
    && !asset.storage_path.startsWith("generated/") && !/^https?:/.test(asset.storage_path);
}

// How well each kind of picture works as a small cover; absent kinds count as 0
const TYPE_SCORE: Record<string, number> = { photo: 8, drawing: 5, map: 4, diagram: 3, flowchart: 3, chart: 2, screenshot: 1, logo: -4, table: -6, "document scan": -6 };

const OWN_LOGO_SCORE = 10;

const words = (text: string) => new Set(text.toLocaleLowerCase().match(/\p{L}{4,}/gu) ?? []);

// BEST FIRST, and the same order every time for the same assets. Picture type counts most,
// then words shared with the Space's name and pages, then having a description at all.
// A logo normally ranks low, but the Space's own logo, one named after it, beats a photo.
export function rankThumbnailAssets<T extends ThumbnailAsset>(assets: readonly T[], context: ThumbnailContext): T[] {
  const about = words([context.title, context.description, ...context.pageTitles].join(" "));
  const name = words(context.title);
  const score = (asset: T) => {
    const own = words([asset.title, asset.description, ...(asset.tags ?? [])].filter(Boolean).join(" "));
    const shared = [...own].filter(word => about.has(word)).length;
    const ownLogo = asset.asset_type === "logo" && [...words(asset.title ?? "")].some(word => name.has(word));
    return (ownLogo ? OWN_LOGO_SCORE : TYPE_SCORE[asset.asset_type ?? ""] ?? 0) + Math.min(shared, 6) + (asset.description ? 1 : 0);
  };
  return assets.filter(canBeThumbnail)
    .map(asset => ({ asset, score: score(asset) }))
    .sort((a, b) => b.score - a.score || b.asset.created_at.localeCompare(a.asset.created_at) || a.asset.id.localeCompare(b.asset.id))
    .map(({ asset }) => asset);
}

const COVERS = [
  { base: "#23372a", shapes: ["#496748", "#7fa37d", "#d9b56a"] },
  { base: "#1f2f3f", shapes: ["#3a5a7a", "#7d9fc0", "#e0c98f"] },
  { base: "#3a2a1c", shapes: ["#8a5a1c", "#c99a55", "#f2dfae"] },
  { base: "#33263a", shapes: ["#5f4770", "#a58bb8", "#e6c3a0"] },
  { base: "#2c2c24", shapes: ["#5c5c46", "#a3a381", "#e3d9a6"] },
  { base: "#3a2422", shapes: ["#7d4238", "#c98a78", "#efd2b0"] },
];

export type SpaceCover = { base: string; circles: { cx: number; cy: number; r: number; fill: string }[]; initial: string };

// THE LAST FALLBACK: a flat cover worked out from the slug alone, so a Space keeps the same one
export function spaceCover(slug: string, title: string): SpaceCover {
  let hash = 2166136261;
  for (const char of slug) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const next = (limit: number) => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822519);
    hash ^= hash >>> 13;
    return (hash >>> 0) % limit;
  };
  const palette = COVERS[next(COVERS.length)]!;
  const circles = palette.shapes.map((fill, i) => ({ cx: 40 + next(400), cy: 30 + next(240), r: [150, 96, 44][i]! + next(30), fill }));
  return { base: palette.base, circles, initial: Array.from(title.trim())[0]?.toLocaleUpperCase() ?? "" };
}
