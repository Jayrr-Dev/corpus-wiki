import { WikiPageView } from "./WikiPageView";

type WikiPageProps = { params: Promise<{ slug: string }> };

// PAGE (/p/[slug]): a Wikipedia-like page whose sections rebuild live after each commit
export default async function WikiPage({ params }: WikiPageProps) {
  const { slug } = await params;
  return <WikiPageView slug={slug} />;
}
