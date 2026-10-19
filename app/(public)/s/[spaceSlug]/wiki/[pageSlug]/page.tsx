import { PublicWikiReader } from "@/components/publishing/PublicWikiReader";

export default async function PublicArticlePage({ params, searchParams }: { params: Promise<{ spaceSlug: string; pageSlug: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ spaceSlug, pageSlug }, search] = await Promise.all([params, searchParams]);
  return <PublicWikiReader slug={spaceSlug} pageSlug={pageSlug} fromExplore={search.from === "explore"} />;
}
