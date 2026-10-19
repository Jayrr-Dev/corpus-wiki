import { PublicWikiReader } from "@/components/publishing/PublicWikiReader";

export default async function PublicSpacePage({ params, searchParams }: { params: Promise<{ spaceSlug: string }>; searchParams: Promise<{ q?: string; from?: string }> }) {
  const [{ spaceSlug }, search] = await Promise.all([params, searchParams]);
  return <PublicWikiReader slug={spaceSlug} query={typeof search.q === "string" ? search.q.slice(0, 120) : ""} fromExplore={search.from === "explore"} />;
}
