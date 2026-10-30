import type { Metadata } from "next";
import { PublicWikiReader } from "@/components/publishing/PublicWikiReader";
import { readPublicWiki } from "@/lib/publishing/server";

type Props = { params: Promise<{ spaceSlug: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { spaceSlug } = await params;
  const wiki = await readPublicWiki(spaceSlug);
  if (!wiki?.hasGraph) return {};
  const title = `${wiki.title} graph | Corpus Wiki`;
  const description = wiki.description || `A map of the pages in ${wiki.title}.`;
  return { title, description, openGraph: { title, description } };
}

export default async function PublicGraphPage({ params, searchParams }: Props) {
  const [{ spaceSlug }, search] = await Promise.all([params, searchParams]);
  return <PublicWikiReader slug={spaceSlug} pageSlug={typeof search.page === "string" ? search.page : undefined} graphOpen />;
}
