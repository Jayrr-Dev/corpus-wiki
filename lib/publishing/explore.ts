import type { ExploreResult } from "./types";

type Space = ExploreResult["spaces"][number];

const FEATURED_COUNT = 3;

// FEATURED: nobody curates these yet, so the fullest Spaces on the page lead: those with
// their own picture first, then the most articles, then the newest. New gets the rest, and
// a short list skips Featured, so a Space never shows twice and New is never left empty.
export function splitFeatured(spaces: Space[]): { featured: Space[]; recent: Space[] } {
  if (spaces.length <= FEATURED_COUNT) return { featured: [], recent: spaces };
  const ranked = [...spaces].sort((a, b) =>
    Number(Boolean(b.thumbnail_version)) - Number(Boolean(a.thumbnail_version))
    || b.page_count - a.page_count
    || b.published_at.localeCompare(a.published_at));
  const featured = ranked.slice(0, FEATURED_COUNT);
  return { featured, recent: spaces.filter(space => !featured.includes(space)) };
}
