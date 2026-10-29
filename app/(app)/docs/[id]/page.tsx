import { notFound } from "next/navigation";
import { listDocSets, readDocSet } from "@/lib/docs/server";
import { docsTopicNav } from "@/lib/docs/topicNav";
import { loadScopeOptions } from "@/lib/knowledge/scope";
import { requireModule } from "@/lib/modules";
import { DocsReader } from "./DocsReader";

export const dynamic = "force-dynamic";

// DOCS READER (/docs/[id]): the topic bar, page tree, the page, and "In this article" (docs/knowledge-modules-plan.md).
// ?page= picks the page; the first page shows by default. ?view=article shows every page as one article.
export default async function DocSetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string | string[]; view?: string | string[] }> }) {
  await requireModule("docs");
  const [{ id }, { page, view }] = await Promise.all([params, searchParams]);
  const [set, sets, options] = await Promise.all([readDocSet(id), listDocSets(), loadScopeOptions()]);
  if (!set) notFound();
  const pageId = typeof page === "string" && set.pages.some((item) => item.id === page) ? page : (set.pages[0]?.id ?? null);
  return <DocsReader set={set} pageId={pageId} article={view === "article"} topics={docsTopicNav(sets, options)} />;
}
