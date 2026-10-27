import { readArticleTopicLinks } from "@/lib/server-actions/articleTopicLinks";
import { readArticleIllustrations } from "@/lib/server-actions/composer";
import { readRelatedArticles } from "@/lib/server-actions/relatedArticles";

// ARTICLE READS (GET /p/<page id>/reads/<kind>): the article's topic links, related
// articles and Composer illustrations. Server Actions run one at a time per tab, so
// as actions these three queued behind each other; as GETs they load in parallel.
// The [slug] segment holds the page id here. Each read checks the user and the id.
const READS = { links: readArticleTopicLinks, related: readRelatedArticles, figures: readArticleIllustrations };

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug: pageId, kind } = await params;
  const read = READS[kind as keyof typeof READS];
  if (!read) return new Response("Not found", { status: 404 });
  return Response.json(await read(pageId), { headers: { "Cache-Control": "private, no-store" } });
}
