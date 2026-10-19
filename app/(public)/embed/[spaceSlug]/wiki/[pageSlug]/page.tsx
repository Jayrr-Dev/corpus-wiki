import { PublicWikiReader } from "@/components/publishing/PublicWikiReader";

export default async function EmbeddedArticlePage({ params }: { params: Promise<{ spaceSlug: string; pageSlug: string }> }) {
  const { spaceSlug, pageSlug } = await params;
  return <PublicWikiReader slug={spaceSlug} pageSlug={pageSlug} embed />;
}
