import { notFound } from "next/navigation";
import { readDocSet } from "@/lib/docs/server";
import { requireModule } from "@/lib/modules";
import { DocsReader } from "./DocsReader";

export const dynamic = "force-dynamic";

// DOCS READER (/docs/[id]): page tree, the page, and "On this page" (docs/knowledge-modules-plan.md).
// ?page= picks the page; the first page shows by default.
export default async function DocSetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string | string[] }> }) {
  await requireModule("docs");
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  const set = await readDocSet(id);
  if (!set) notFound();
  const pageId = typeof page === "string" && set.pages.some((item) => item.id === page) ? page : (set.pages[0]?.id ?? null);
  return <DocsReader set={set} pageId={pageId} />;
}
