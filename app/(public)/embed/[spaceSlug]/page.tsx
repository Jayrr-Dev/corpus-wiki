import { PublicWikiReader } from "@/components/publishing/PublicWikiReader";

export default async function EmbeddedWikiPage({ params, searchParams }: { params: Promise<{ spaceSlug: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ spaceSlug }, search] = await Promise.all([params, searchParams]);
  return <PublicWikiReader slug={spaceSlug} embed query={typeof search.q === "string" ? search.q.slice(0, 120) : ""} />;
}
